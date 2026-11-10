# backend/app/api/routes/autenticacion.py
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencias import SesionBD
from app.core import seguridad
from app.core.limite_intentos import LimitadorIntentos
from app.models.prueba_vida_log import MetodoPruebaVida
from app.models.usuario import Usuario
from app.schemas.usuario import (
    ConfirmarRegistroRequest,
    OlvideContrasenaRequest,
    ReenviarConfirmacionRequest,
    RegistroRequest,
    RestablecerContrasenaRequest,
    TokenAccesoResponse,
    UsuarioResponse,
)
from app.services import autenticacion_service, dms

router = APIRouter()

# Fuerza bruta: intentos FALLIDOS por (IP, cuenta). Se cuenta por cuenta y no
# solo por IP porque detrás de docker/un proxy todas las peticiones pueden
# compartir IP, y un límite solo por IP bloquearía a todos a la vez.
_login_fallidos = LimitadorIntentos(max_intentos=10, ventana_seg=15 * 60)
# Envíos de recuperación por correo destino (evita bombardear un buzón).
_recuperaciones = LimitadorIntentos(max_intentos=3, ventana_seg=15 * 60)
# Enlaces de confirmación del registro, por cuenta: a lo sumo uno cada 2 min
# (el del alta cuenta). Solo se reenvían a petición (/reenviar-confirmacion):
# cada enlace nuevo invalida el anterior, así que no se mandan por sorpresa.
ESPERA_REENVIO_SEG = 2 * 60
_confirmaciones_registro = LimitadorIntentos(max_intentos=1, ventana_seg=ESPERA_REENVIO_SEG)


def _demasiados_intentos(segundos: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
        headers={"Retry-After": str(segundos)},
    )


def _autenticar(request: Request, db: Session, identificador: str, password: str) -> Usuario:
    """Usuario (por correo o username) con esa contraseña, o 401/429. Lleva
    la cuenta de intentos fallidos por (IP, cuenta) contra fuerza bruta."""
    ip = request.client.host if request.client else None
    clave = f"{ip}|{identificador.strip().lower()}"
    espera = _login_fallidos.segundos_restantes(clave)
    if espera:
        raise _demasiados_intentos(espera)

    usuario = autenticacion_service.buscar_por_correo(db, correo=identificador)
    if not usuario:
        # El username sí distingue mayúsculas/minúsculas (exacto=True).
        usuario = autenticacion_service.buscar_por_username(db, username=identificador, exacto=True)

    if usuario is None:
        valida = seguridad.verificar_contrasena_senuelo(password)
    else:
        valida = seguridad.verificar_contrasena(password, usuario.hash_pass)

    if usuario is None or not valida:
        _login_fallidos.registrar(clave)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    _login_fallidos.reiniciar(clave)
    return usuario


def _cuenta_sin_confirmar(usuario: Usuario) -> JSONResponse:
    """403 para quien da la contraseña correcta de una cuenta sin confirmar.
    `codigo` le dice al frontend que ofrezca reenviar el enlace."""
    correo = autenticacion_service.correo_enmascarado(usuario.correo)
    return JSONResponse(
        status_code=status.HTTP_403_FORBIDDEN,
        content={
            "detail": (
                f"Tu cuenta aún no está activada. Ábrela con el enlace que enviamos a {correo}. "
                "Si no te llegó, revisa la carpeta de spam o pide otro."
            ),
            "codigo": "cuenta_sin_confirmar",
            "correo": correo,
        },
    )


@router.post("/register", response_model=UsuarioResponse, status_code=status.HTTP_201_CREATED)
def registrar(registro: RegistroRequest, db: SesionBD) -> Usuario:
    if autenticacion_service.buscar_por_correo(db, correo=registro.correo):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El correo electrónico ya está registrado.",
        )
    if autenticacion_service.buscar_por_username(db, username=registro.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="El nombre de usuario ya está en uso."
        )
    try:
        usuario = autenticacion_service.registrar_usuario(db, registro)
    except IntegrityError:
        # Dos altas simultáneas con el mismo correo/usuario: lo decide el
        # UNIQUE (la unidad de trabajo revierte al propagarse el error).
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El correo o el nombre de usuario ya están registrados.",
        ) from None
    autenticacion_service.enviar_confirmacion_registro(db, usuario)
    _confirmaciones_registro.registrar(str(usuario.id))
    return usuario


@router.post("/confirmar-registro", status_code=status.HTTP_200_OK)
def confirmar_registro(datos: ConfirmarRegistroRequest, db: SesionBD) -> dict[str, str]:
    """Sin autenticación: se llega desde el enlace del correo (mismo criterio
    que /reset-password)."""
    autenticacion_service.confirmar_registro(db, datos.token)
    return {"detail": "Correo confirmado. Ya puedes iniciar sesión."}


@router.post("/reenviar-confirmacion", status_code=status.HTTP_200_OK, response_model=None)
def reenviar_confirmacion(
    datos: ReenviarConfirmacionRequest, request: Request, db: SesionBD
) -> dict[str, Any] | JSONResponse:
    """Manda un enlace nuevo de confirmación del registro (el anterior deja
    de servir). Pide las credenciales de la cuenta, como el login; a lo sumo
    uno cada ESPERA_REENVIO_SEG por cuenta (429 con Retry-After)."""
    usuario = _autenticar(request, db, datos.usuario, datos.password)
    if usuario.correo_verificado:
        return {"detail": "Tu cuenta ya está activada: inicia sesión.", "espera_segundos": 0}
    clave = str(usuario.id)
    espera = _confirmaciones_registro.segundos_restantes(clave)
    if espera:
        # `espera_segundos` también en el cuerpo: entre orígenes distintos el
        # navegador no deja leer Retry-After sin exponerlo por CORS.
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "detail": f"Ya te enviamos un enlace hace poco. Podrás pedir otro en {espera} segundos.",
                "espera_segundos": espera,
            },
            headers={"Retry-After": str(espera)},
        )
    _confirmaciones_registro.registrar(clave)
    autenticacion_service.enviar_confirmacion_registro(db, usuario)
    correo = autenticacion_service.correo_enmascarado(usuario.correo)
    return {
        "detail": f"Te enviamos un nuevo enlace a {correo}. Los anteriores dejan de servir.",
        "espera_segundos": ESPERA_REENVIO_SEG,
    }


@router.post("/login", response_model=TokenAccesoResponse)
def iniciar_sesion(
    request: Request,
    db: SesionBD,
    formulario: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> dict[str, Any] | JSONResponse:
    usuario = _autenticar(request, db, formulario.username, formulario.password)

    # Después de validar la contraseña: a quien no la tiene no se le revela
    # si la cuenta existe ni si está confirmada.
    if not usuario.correo_verificado:
        return _cuenta_sin_confirmar(usuario)

    ip = request.client.host if request.client else None
    dms.registrar_prueba_de_vida(
        db,
        usuario,
        metodo=MetodoPruebaVida.web_interface,
        identificador=usuario.correo,
        ip_origen=ip,
    )

    token_acceso = seguridad.crear_token_acceso(sujeto=str(usuario.id))

    return {"access_token": token_acceso, "token_type": "bearer"}


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def olvide_contrasena(datos: OlvideContrasenaRequest, db: SesionBD) -> dict[str, str]:
    """
    Genera un TokenRecuperacion si el correo existe. Responde siempre el mismo
    mensaje genérico, y el envío sale de la cola de notificaciones: así ni
    el contenido ni el tiempo de respuesta revelan si el correo está
    registrado.
    """
    clave = datos.correo.lower()
    espera = _recuperaciones.segundos_restantes(clave)
    if espera:
        raise _demasiados_intentos(espera)
    _recuperaciones.registrar(clave)

    usuario = autenticacion_service.buscar_por_correo(db, correo=datos.correo)
    if usuario:
        autenticacion_service.solicitar_recuperacion(db, usuario)

    return {"detail": "Si el correo existe, se enviaron instrucciones de recuperación."}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
def restablecer_contrasena(datos: RestablecerContrasenaRequest, db: SesionBD) -> dict[str, str]:
    token = autenticacion_service.token_recuperacion_vigente(db, datos.token)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token inválido, expirado o ya utilizado.",
        )

    hash_nuevo = seguridad.hash_contrasena(datos.nueva_password)
    autenticacion_service.restablecer_con_token(db, token, hash_nuevo)

    return {"detail": "Contraseña actualizada correctamente."}
