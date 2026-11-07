# backend/app/api/dependencias.py
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core import seguridad
from app.db.sesion import obtener_sesion
from app.models.usuario import EstadoDMS, RolUsuario, Usuario

# Le indica a FastAPI (y a Swagger) dónde está el endpoint para obtener el token
esquema_oauth2 = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# Sesión de BD = unidad de trabajo de la petición (ver db/sesion.obtener_sesion).
# scope="function": se confirma al terminar el endpoint, ANTES de responder.
SesionBD = Annotated[Session, Depends(obtener_sesion, scope="function")]


def obtener_usuario_actual(db: SesionBD, token: Annotated[str, Depends(esquema_oauth2)]) -> Usuario:
    """
    Dependencia para rutas protegidas.
    Decodifica el token de acceso (JWT), extrae el ID de usuario ('sub') y lo
    busca en la BD. Si el token es inválido o el usuario fue eliminado,
    lanza 401.
    """
    no_autenticado = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudieron validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )

    datos = seguridad.decodificar_token_acceso(token)
    if datos is None:
        raise no_autenticado

    try:
        id_usuario = int(str(datos["sub"]))
    except (KeyError, TypeError, ValueError):
        raise no_autenticado from None

    usuario = db.get(Usuario, id_usuario)
    if usuario is None:
        raise no_autenticado

    return usuario


# Rutas que un propietario en cola de eliminación SÍ puede usar (gestionar su
# propia solicitud, ver/editar el perfil). Todo lo demás queda "bloqueado".
_RUTAS_EN_ELIMINACION = ("/api/v1/users/me",)
# Con el patrimonio ya liberado solo queda el resumen de qué lo provocó
# (PatrimonioLiberado.tsx). El resto del panel —bóvedas, activos,
# custodios— está en manos de la recuperación y no debe poder alterarse.
_RUTAS_LIBERADO = ("/api/v1/propietario/liberacion-resumen",)


UsuarioActual = Annotated[Usuario, Depends(obtener_usuario_actual)]


def obtener_propietario_actual(request: Request, usuario: UsuarioActual) -> Usuario:
    """
    Igual que obtener_usuario_actual, pero además exige rol 'propietario'.
    Úsala en rutas de bóvedas/custodios/suscripción, que solo aplican
    a propietarios y no a usuarios admin.

    Si el Interruptor de Hombre Muerto ya liberó el patrimonio, el panel
    queda bloqueado salvo el resumen de la liberación (antes solo lo
    bloqueaba el frontend; la API seguía permitiendo borrar bóvedas o
    activos en plena recuperación).

    Si la cuenta está en la cola de eliminación (derecho de cancelación
    ARCO), queda "bloqueada": solo se permiten las rutas de `/users/me`
    para que pueda cancelar o completar la eliminación.
    """
    if usuario.rol != RolUsuario.propietario:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta acción requiere una cuenta de tipo propietario.",
        )

    prop = usuario.propietario
    if prop is not None and prop.status_dms is EstadoDMS.liberado:
        if not request.url.path.startswith(_RUTAS_LIBERADO):
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail="Tu patrimonio ya fue liberado y está en recuperación; "
                "el panel quedó bloqueado.",
            )
        return usuario

    if (
        prop is not None
        and prop.eliminacion_solicitada_en is not None
        and not request.url.path.startswith(_RUTAS_EN_ELIMINACION)
    ):
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Tu cuenta está en proceso de eliminación. "
            "Cancela la solicitud para volver a usar la aplicación.",
        )
    return usuario


PropietarioActual = Annotated[Usuario, Depends(obtener_propietario_actual)]


def obtener_admin_actual(usuario: UsuarioActual) -> Usuario:
    """Igual que obtener_usuario_actual, pero además exige rol 'admin'. Úsala
    en las rutas del panel admin (/api/v1/admin/...)."""
    if usuario.rol != RolUsuario.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta acción requiere una cuenta de administrador.",
        )
    return usuario


AdminActual = Annotated[Usuario, Depends(obtener_admin_actual)]
