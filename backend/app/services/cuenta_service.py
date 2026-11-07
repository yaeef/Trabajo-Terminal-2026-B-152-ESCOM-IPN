# backend/app/services/cuenta_service.py
"""
Cuenta del propietario: perfil y contraseña, eliminación de la cuenta
(derecho ARCO de cancelación) con periodo de gracia y purga, y el correo
secundario verificado.
"""

import logging
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core import seguridad
from app.core.config import settings
from app.core.tiempo import ahora, utc
from app.models.boveda import Boveda, CustodioBoveda
from app.models.codigo_telegram import CodigoVinculacionTelegram
from app.models.custodio import Custodio
from app.models.token_recuperacion import TokenRecuperacion
from app.models.usuario import EstadoDMS, Propietario, Usuario
from app.models.verificacion_correo import VerificacionCorreoRegistro, VerificacionCorreoSec
from app.schemas.usuario import PerfilEditarRequest
from app.services import boveda_service, custodio_service, dms, notificaciones, tokens
from app.services.dms import Evento
from app.services.errores import DatoInvalido
from app.services.tokens import EstadoToken

logger = logging.getLogger("b152.cuentas")

VIGENCIA_CORREO_SEC_MIN = 30


def editar_perfil(db: Session, usuario: Usuario, datos: PerfilEditarRequest) -> Usuario:
    cambios = datos.model_dump(exclude_unset=True)
    if cambios.get("nombre") is None:
        cambios.pop("nombre", None)  # `nombre: null` no puede vaciar una columna NOT NULL
    for campo, valor in cambios.items():
        setattr(usuario, campo, valor)
    db.flush()
    db.refresh(usuario)
    return usuario


def cambiar_contrasena(
    db: Session, usuario: Usuario, password_actual: str, nueva_password: str
) -> None:
    if not seguridad.verificar_contrasena(password_actual, usuario.hash_pass):
        raise DatoInvalido("La contraseña actual es incorrecta.")
    if seguridad.verificar_contrasena(nueva_password, usuario.hash_pass):
        raise DatoInvalido("La nueva contraseña debe ser distinta a la actual.")

    usuario.hash_pass = seguridad.hash_contrasena(nueva_password)


def _purgar_cuenta(db: Session, usuario: Usuario) -> None:
    """
    Purga IRREVERSIBLE de todo el patrimonio del propietario y anonimización
    de la identidad. NO valida contraseña ni confirma la transacción: eso
    es del llamador (`eliminar_ahora`, `procesar_cola_eliminacion`).

    Purga: cada bóveda con sus activos cifrados (blobs en Azurite + filas),
    asignaciones de custodios y compromisos VSS; el directorio de custodios y
    sus tokens de verificación; tokens de recuperación, de confirmación del
    registro y de verificación del correo secundario.

    NO borra la fila `usuario`: la anonimiza. Borrarla rompería la integridad
    con lo que se conserva a propósito: `prueba_vida_log` (auditoría, que se
    anonimiza) y `propietario_suscripcion` (historial de plan, sin PII). Los
    custodios no tienen cuenta propia, así que no hay "custodio afectado".
    """
    prop = usuario.propietario

    # 1. Patrimonio: bóvedas + activos/blobs + asignaciones + compromisos
    if prop is not None:
        for boveda in db.query(Boveda).filter(Boveda.id_propietario == prop.id).all():
            boveda_service.purgar_boveda(db, boveda)

        # 2. Directorio de custodios: todo lo que los referencia por FK (tokens,
        #    códigos de Telegram, votos DMS) -> vínculos -> custodios
        ids_custodios = [
            c.id for c in db.query(Custodio).filter(Custodio.id_propietario == prop.id).all()
        ]
        if ids_custodios:
            custodio_service.purgar_referencias(db, ids_custodios)
            db.query(CustodioBoveda).filter(CustodioBoveda.id_custodio.in_(ids_custodios)).delete(
                synchronize_session=False
            )
            db.query(Custodio).filter(Custodio.id_propietario == prop.id).delete(
                synchronize_session=False
            )

    # 3. Bitácora del DMS: se anonimiza, no se borra
    dms.anonimizar_bitacora(usuario)

    # 4. Tokens y códigos de un solo uso (recuperación, confirmación del registro,
    #    correo secundario, Telegram)
    db.query(TokenRecuperacion).filter(TokenRecuperacion.id_usuario == usuario.id).delete()
    db.query(VerificacionCorreoRegistro).filter(
        VerificacionCorreoRegistro.id_usuario == usuario.id
    ).delete()
    db.query(VerificacionCorreoSec).filter(VerificacionCorreoSec.id_usuario == usuario.id).delete()
    db.query(CodigoVinculacionTelegram).filter(
        CodigoVinculacionTelegram.id_usuario == usuario.id
    ).delete()

    # 5. Identidad: se anonimiza (placeholder único para no violar UNIQUE en username/correo)
    marcador = f"usuario_eliminado_{usuario.id}"
    usuario.username = marcador
    usuario.nombre = "Usuario eliminado"
    usuario.materno = None
    usuario.paterno = None
    usuario.correo = f"{marcador}@baja.local"
    usuario.correo_sec = None
    usuario.id_telegram = None
    usuario.hash_pass = seguridad.hash_contrasena(secrets.token_urlsafe(32))  # login imposible

    if prop is not None:
        dms.disparar(db, prop, Evento.cuenta_purgada)
        prop.eliminacion_solicitada_en = None
        prop.eliminacion_recordatorio_enviado = False


def purgar_ahora_admin(db: Session, usuario: Usuario) -> None:
    """Purga inmediata sin periodo de gracia, para soporte/legal (p. ej. una
    solicitud ARCO urgente). A diferencia de `eliminar_ahora`, no exige la
    contraseña del propietario: lo autoriza el admin que llama, que debe
    quedar registrado en la auditoría de quien invoque esta función."""
    _purgar_cuenta(db, usuario)


def _fecha(momento: datetime) -> str:
    return momento.strftime("%d/%m/%Y")


def _avisar_eliminacion(db: Session, usuario: Usuario, plantilla: str, **datos: str) -> None:
    notificaciones.encolar_correo(db, usuario.correo, plantilla, nombre=usuario.nombre, **datos)


def solicitar_eliminacion(db: Session, usuario: Usuario, contrasena: str) -> datetime:
    """
    Derecho de cancelación (ARCO). Encola la cuenta para eliminación: no
    borra nada todavía, solo la marca como "bloqueada". Un job la purga al
    cumplirse `ACCOUNT_DELETION_GRACE_DAYS` si no se cancela antes.
    Pausa el Interruptor de Hombre Muerto mientras dure la solicitud.
    Idempotente: si ya había solicitud, devuelve la misma fecha de purga.
    """
    if not seguridad.verificar_contrasena(contrasena, usuario.hash_pass):
        raise DatoInvalido("Contraseña incorrecta. No se realizó ningún cambio.")

    prop = usuario.propietario
    if prop is None:
        raise DatoInvalido("Solo las cuentas de tipo propietario pueden eliminarse.")

    if prop.eliminacion_solicitada_en is None:
        prop.eliminacion_solicitada_en = ahora()
        prop.eliminacion_recordatorio_enviado = False
        dms.disparar(db, prop, Evento.eliminacion_solicitada)

    purga_en = utc(prop.eliminacion_solicitada_en) + timedelta(
        days=settings.ACCOUNT_DELETION_GRACE_DAYS
    )
    _avisar_eliminacion(db, usuario, "eliminacion_programada", fecha=_fecha(purga_en))
    return purga_en


def cancelar_eliminacion(db: Session, usuario: Usuario) -> None:
    """Cancela una solicitud de eliminación pendiente y reactiva el DMS."""
    prop = usuario.propietario
    if prop is None or prop.eliminacion_solicitada_en is None:
        raise DatoInvalido("No hay ninguna solicitud de eliminación activa.")

    prop.eliminacion_solicitada_en = None
    prop.eliminacion_recordatorio_enviado = False
    if prop.status_dms is EstadoDMS.pausado_eliminacion:
        dms.disparar(db, prop, Evento.eliminacion_cancelada)
    _avisar_eliminacion(db, usuario, "eliminacion_cancelada")


def eliminar_ahora(db: Session, usuario: Usuario, contrasena: str) -> None:
    """Purga inmediata (opción "Eliminar ahora" desde la pantalla de cuenta
    en eliminación). Exige la contraseña de nuevo."""
    if not seguridad.verificar_contrasena(contrasena, usuario.hash_pass):
        raise DatoInvalido("Contraseña incorrecta. No se realizó ningún cambio.")
    _purgar_cuenta(db, usuario)


def procesar_cola_eliminacion(db: Session) -> int:
    """
    Lo llama el barrido periódico (services/tareas_periodicas.py). Purga las
    cuentas cuyo periodo de gracia venció y manda el recordatorio a las que
    están a punto de vencer. Devuelve cuántas se purgaron. Una transacción
    por cuenta.
    """
    momento = ahora()
    gracia = timedelta(days=settings.ACCOUNT_DELETION_GRACE_DAYS)
    ventana = timedelta(days=settings.ACCOUNT_DELETION_REMINDER_DAYS)

    pendientes = (
        db.query(Propietario).filter(Propietario.eliminacion_solicitada_en.isnot(None)).all()
    )

    purgadas = 0
    for prop in pendientes:
        # Cada cuenta en su propio try: una purga fallida no debe impedir las
        # demás ni (vía el barrido periódico) la evaluación del DMS de todo el sistema.
        try:
            solicitada = utc(prop.eliminacion_solicitada_en)
            if solicitada is None:  # la canceló mientras corría el barrido
                continue
            purga_en = solicitada + gracia

            usuario = db.get(Usuario, prop.id)
            if usuario is None:
                continue

            if momento >= purga_en:
                _purgar_cuenta(db, usuario)
                db.commit()
                purgadas += 1
            elif momento >= purga_en - ventana and not prop.eliminacion_recordatorio_enviado:
                _avisar_eliminacion(db, usuario, "eliminacion_recordatorio", fecha=_fecha(purga_en))
                prop.eliminacion_recordatorio_enviado = True
                db.commit()
        except Exception:
            db.rollback()
            logger.exception("Fallo procesando la eliminación de la cuenta %s", prop.id)

    return purgadas


def solicitar_correo_secundario(db: Session, usuario: Usuario, correo_nuevo: str) -> None:
    """
    Paso 1: emite el token y manda el enlace de confirmación al correo
    nuevo. usuario.correo_sec no cambia hasta confirmar.
    """
    _, en_claro = tokens.emitir(
        db,
        VerificacionCorreoSec,
        VerificacionCorreoSec.id_usuario == usuario.id,
        vigencia=timedelta(minutes=VIGENCIA_CORREO_SEC_MIN),
        id_usuario=usuario.id,
        correo_nuevo=correo_nuevo,
    )
    notificaciones.encolar_correo(
        db,
        correo_nuevo,
        "correo_secundario",
        enlace=f"{settings.FRONTEND_CONFIRM_EMAIL_URL}?token={en_claro}",
    )


def confirmar_correo_secundario(db: Session, token: str) -> None:
    """
    Paso 2: se llama desde el link del correo, sin sesión activa necesaria.
    Volver a abrir un enlace ya usado no es un error mientras ese correo siga
    vinculado (doble clic, recargar la página); si después se desvinculó o se
    cambió por otro, el enlace viejo ya no sirve.
    """
    registro, estado = tokens.buscar(db, VerificacionCorreoSec, token)
    usuario = db.get(Usuario, registro.id_usuario) if registro is not None else None
    if (
        estado is EstadoToken.USADO
        and registro is not None
        and usuario is not None
        and usuario.correo_sec == registro.correo_nuevo
    ):
        return
    if estado is EstadoToken.EXPIRADO:
        raise DatoInvalido("El enlace de confirmación expiró.")
    if registro is None or usuario is None or estado is not EstadoToken.VIGENTE:
        raise DatoInvalido("Enlace inválido o ya utilizado.")

    usuario.correo_sec = registro.correo_nuevo
    registro.usado = True


def desvincular_correo_secundario(usuario: Usuario) -> None:
    usuario.correo_sec = None
