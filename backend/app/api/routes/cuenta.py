# backend/app/api/routes/cuenta.py
"""Cuenta del usuario autenticado (/users/me): perfil, contraseña y eliminación."""

from typing import Any

from fastapi import APIRouter, status

from app.api.dependencias import PropietarioActual, SesionBD, UsuarioActual
from app.models.usuario import Usuario
from app.schemas.usuario import (
    CambiarContrasenaRequest,
    EliminacionCuentaResponse,
    EliminarCuentaRequest,
    PerfilEditarRequest,
    UsuarioResponse,
)
from app.services import cuenta_service

router = APIRouter()


@router.get("/me", response_model=UsuarioResponse)
def leer_mi_cuenta(usuario: UsuarioActual) -> Usuario:
    """
    Ruta protegida. Devuelve la información del usuario autenticado.
    Requiere un JWT de acceso válido en el header Authorization.
    """
    return usuario


@router.patch("/me", response_model=UsuarioResponse)
def editar_perfil(
    datos: PerfilEditarRequest,
    usuario: UsuarioActual,
    db: SesionBD,
) -> Usuario:
    """Edita nombre y apellidos (los canales tienen su propio flujo verificado)."""
    return cuenta_service.editar_perfil(db, usuario, datos)


@router.put("/me/password", status_code=status.HTTP_200_OK)
def cambiar_mi_contrasena(
    datos: CambiarContrasenaRequest,
    usuario: UsuarioActual,
    db: SesionBD,
) -> dict[str, str]:
    """Exige la contraseña actual; la nueva debe ser distinta."""
    cuenta_service.cambiar_contrasena(db, usuario, datos.password_actual, datos.nueva_password)
    return {"detail": "Contraseña actualizada correctamente."}


@router.delete("/me", response_model=EliminacionCuentaResponse, status_code=status.HTTP_200_OK)
def solicitar_eliminacion(
    datos: EliminarCuentaRequest,
    usuario: PropietarioActual,  # solo propietarios, por diseño
    db: SesionBD,
) -> dict[str, Any]:
    """Encola la cuenta para eliminación con periodo de gracia (no borra nada aún)."""
    purga_en = cuenta_service.solicitar_eliminacion(db, usuario, datos.password)
    return {
        "detail": "Tu cuenta quedó programada para eliminarse. "
        "Puedes cancelar iniciando sesión antes de esa fecha.",
        "purga_en": purga_en,
    }


@router.post("/me/eliminacion/cancelar", status_code=status.HTTP_200_OK)
def cancelar_eliminacion(
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, str]:
    """Cancela la solicitud de eliminación y reactiva el Interruptor de Hombre Muerto."""
    cuenta_service.cancelar_eliminacion(db, usuario)
    return {"detail": "Se canceló la eliminación. Tu cuenta vuelve a estar activa."}


@router.post("/me/eliminacion/ahora", status_code=status.HTTP_200_OK)
def eliminar_ahora(
    datos: EliminarCuentaRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, str]:
    """Purga inmediata e irreversible; exige la contraseña de nuevo."""
    cuenta_service.eliminar_ahora(db, usuario, datos.password)
    return {
        "detail": "Tu cuenta y tu patrimonio fueron eliminados. La identidad quedó anonimizada."
    }
