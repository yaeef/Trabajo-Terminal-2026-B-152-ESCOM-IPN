# backend/app/api/routes/canales.py
from fastapi import APIRouter, HTTPException, status

from app.api.dependencias import SesionBD, UsuarioActual
from app.schemas.usuario import (
    CodigoTelegramResponse,
    ConfirmarCorreoSecundarioRequest,
    CorreoSecundarioRequest,
)
from app.services import cuenta_service, telegram_service

router = APIRouter()


@router.post("/correo-secundario", status_code=status.HTTP_202_ACCEPTED)
def solicitar_correo_secundario(
    datos: CorreoSecundarioRequest,
    usuario: UsuarioActual,
    db: SesionBD,
) -> dict[str, str]:
    if datos.correo_nuevo.lower() == (usuario.correo or "").lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El correo alternativo debe ser distinto al correo principal.",
        )

    cuenta_service.solicitar_correo_secundario(db, usuario, datos.correo_nuevo)

    return {"detail": "Revisa la bandeja de entrada de ese correo para confirmar la vinculación."}


@router.post("/correo-secundario/confirmar", status_code=status.HTTP_200_OK)
def confirmar_correo_secundario(
    datos: ConfirmarCorreoSecundarioRequest, db: SesionBD
) -> dict[str, str]:
    """
    Sin autenticación: el usuario llega aquí desde el link del correo,
    posiblemente sin sesión activa (mismo criterio que /reset-password).
    """
    cuenta_service.confirmar_correo_secundario(db, datos.token)
    return {"detail": "Correo alternativo confirmado correctamente."}


@router.delete("/correo-secundario", status_code=status.HTTP_200_OK)
def desvincular_correo_secundario(
    usuario: UsuarioActual,
    db: SesionBD,
) -> dict[str, str]:
    cuenta_service.desvincular_correo_secundario(usuario)
    return {"detail": "Correo alternativo desvinculado."}


@router.post("/telegram/link-code", response_model=CodigoTelegramResponse)
def crear_codigo_telegram(
    usuario: UsuarioActual,
    db: SesionBD,
) -> CodigoTelegramResponse:
    return telegram_service.generar_codigo_propietario(db, usuario)


@router.delete("/telegram", status_code=status.HTTP_200_OK)
def desvincular_telegram(
    usuario: UsuarioActual,
    db: SesionBD,
) -> dict[str, str]:
    telegram_service.desvincular(usuario)
    return {"detail": "Telegram desvinculado correctamente."}
