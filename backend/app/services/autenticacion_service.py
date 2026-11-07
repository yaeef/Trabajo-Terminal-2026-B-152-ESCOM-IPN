# backend/app/services/autenticacion_service.py
"""
Alta de cuentas, confirmación del correo del registro y recuperación de
contraseña. El JWT de sesión y las contraseñas viven en core/seguridad.py;
el inicio de sesión (límite de intentos, prueba de vida) en
api/routes/autenticacion.py.
"""

from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.seguridad import hash_contrasena
from app.core.tiempo import hoy
from app.models.suscripcion import PropietarioSuscripcion
from app.models.token_recuperacion import TokenRecuperacion
from app.models.usuario import EstadoDMS, Propietario, RolUsuario, Usuario
from app.models.verificacion_correo import VerificacionCorreoRegistro
from app.schemas.usuario import RegistroRequest
from app.services import cuota, notificaciones, tokens
from app.services.errores import DatoInvalido
from app.services.tokens import EstadoToken

VIGENCIA_RECUPERACION_MIN = 30
VIGENCIA_CONFIRMACION_REGISTRO_HORAS = 24

# Configuración inicial del Interruptor de Hombre Muerto para toda cuenta nueva.
UMBRAL_INACTIVIDAD_INICIAL_DIAS = 60
PERIODO_GRACIA_INICIAL_DIAS = 7


def buscar_por_correo(db: Session, correo: str) -> Usuario | None:
    return db.query(Usuario).filter(Usuario.correo == correo).first()


def buscar_por_username(db: Session, username: str, exacto: bool = False) -> Usuario | None:
    """
    Busca por username. La columna usa collation *_ci (case-insensitive), útil
    para impedir altas que solo difieran en mayúsculas/minúsculas.

    Para el LOGIN se pasa `exacto=True`: el username debe coincidir carácter
    por carácter. Así, si el usuario es "yaef", no se puede entrar con "YAEF"
    ni "Yaef". (La comparación *_ci trae la única fila candidata y luego se
    exige igualdad exacta en Python.)
    """
    usuario = db.query(Usuario).filter(Usuario.username == username).first()
    if exacto and usuario is not None and usuario.username != username:
        return None
    return usuario


def registrar_usuario(db: Session, registro: RegistroRequest) -> Usuario:
    """
    Crea el usuario, su especialización como propietario, y lo suscribe
    automáticamente al plan Gratuito. Las tres operaciones van en la misma
    transacción: si algo falla, se revierte todo (no queda un usuario
    "huérfano" sin propietario ni suscripción).

    El correo secundario y el Telegram NO se aceptan en el alta: solo se
    fijan por sus flujos verificados (/canales/correo-secundario y el
    /start del bot), porque el DMS y la recuperación de cuenta les envían
    mensajes — aceptarlos sin verificar permitía dirigirlos a un tercero.

    La cuenta nace con el correo SIN confirmar: /login la rechaza hasta que
    se use el enlace de `enviar_confirmacion_registro`, que manda el llamador.
    """
    hash_guardado = hash_contrasena(registro.password)

    usuario = Usuario(
        username=registro.username,
        nombre=registro.nombre,
        materno=registro.materno,
        paterno=registro.paterno,
        correo=registro.correo,
        correo_verificado=False,
        hash_pass=hash_guardado,
        rol=RolUsuario.propietario,
    )
    db.add(usuario)
    db.flush()  # asigna db_user.id sin cerrar la transacción

    propietario = Propietario(
        id=usuario.id,
        status_dms=EstadoDMS.activo,
        periodicidad_prueba=UMBRAL_INACTIVIDAD_INICIAL_DIAS,
        periodicidad_periodo_gracia=PERIODO_GRACIA_INICIAL_DIAS,
    )
    db.add(propietario)
    db.flush()

    suscripcion = PropietarioSuscripcion(
        id_propietario=propietario.id,
        id_suscripcion=cuota.ID_PLAN_GRATUITO,
        fecha_inicio=hoy(),
        fecha_fin=None,
    )
    db.add(suscripcion)
    db.flush()  # un alta duplicada (carrera con otra igual) falla aquí, con IntegrityError
    db.refresh(usuario)
    return usuario


# --------------------------------------------------------------------------
# Confirmación del correo al registrarse
# --------------------------------------------------------------------------


def enviar_confirmacion_registro(db: Session, usuario: Usuario) -> None:
    """Emite el token de confirmación del correo principal (solo sirve el
    último, ver services/tokens.py) y manda el enlace a ese correo."""
    _, en_claro = tokens.emitir(
        db,
        VerificacionCorreoRegistro,
        VerificacionCorreoRegistro.id_usuario == usuario.id,
        vigencia=timedelta(hours=VIGENCIA_CONFIRMACION_REGISTRO_HORAS),
        id_usuario=usuario.id,
    )
    enlace = f"{settings.FRONTEND_CONFIRM_REGISTRO_URL}?token={en_claro}"
    notificaciones.encolar_correo(db, usuario.correo, "confirmacion_registro", enlace=enlace)


def confirmar_registro(db: Session, token: str) -> None:
    """Se llama desde el enlace del correo, sin sesión. Volver a abrir un
    enlace ya usado de una cuenta confirmada no es un error (doble clic,
    recargar la página)."""
    registro, estado = tokens.buscar(db, VerificacionCorreoRegistro, token)
    usuario = db.get(Usuario, registro.id_usuario) if registro is not None else None
    if estado is EstadoToken.USADO and usuario is not None and usuario.correo_verificado:
        return
    if estado is EstadoToken.EXPIRADO:
        raise DatoInvalido(
            "El enlace de confirmación expiró. Inicia sesión con tu usuario y contraseña "
            "para recibir uno nuevo."
        )
    if usuario is None or registro is None or estado is not EstadoToken.VIGENTE:
        raise DatoInvalido(
            "Enlace inválido o ya utilizado. Si pediste más de uno, usa el más reciente."
        )
    usuario.correo_verificado = True
    registro.usado = True


# --------------------------------------------------------------------------
# Recuperación de cuenta (usa TokenRecuperacion, NO confundir con el JWT de acceso)
# --------------------------------------------------------------------------


def solicitar_recuperacion(db: Session, usuario: Usuario) -> None:
    """Emite el token de recuperación (solo sirve el último, ver
    services/tokens.py) y manda el enlace por correo y, si lo vinculó, por
    Telegram."""
    _, en_claro = tokens.emitir(
        db,
        TokenRecuperacion,
        TokenRecuperacion.id_usuario == usuario.id,
        vigencia=timedelta(minutes=VIGENCIA_RECUPERACION_MIN),
        id_usuario=usuario.id,
    )
    enlace = f"{settings.FRONTEND_RESET_URL}?token={en_claro}"
    notificaciones.encolar_correo(db, usuario.correo, "recuperacion", enlace=enlace)
    notificaciones.encolar_telegram(db, usuario.id_telegram, "recuperacion", enlace=enlace)


def token_recuperacion_vigente(db: Session, token: str) -> TokenRecuperacion | None:
    return tokens.vigente(db, TokenRecuperacion, token)


def restablecer_con_token(db: Session, token: TokenRecuperacion, hash_nuevo: str) -> None:
    token.usuario.hash_pass = hash_nuevo
    # El enlace solo llega a quien controla el correo principal (una cuenta
    # sin confirmar aún no puede tener Telegram), así que también lo confirma.
    token.usuario.correo_verificado = True
    tokens.descartar_pendientes(
        db, TokenRecuperacion, TokenRecuperacion.id_usuario == token.id_usuario
    )
