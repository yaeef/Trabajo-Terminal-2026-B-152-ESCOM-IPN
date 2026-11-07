# backend/app/api/routes/custodios.py
"""
CU-010 a CU-014 — Directorio de custodios del propietario.

NO incluye la vinculación custodio<->bóveda (CU-013/CU-022): por decisión
de arquitectura esa mutación vive en el dominio de bóvedas
(PUT /bovedas/{id}/custodios). Por eso aquí no hay ningún endpoint tipo
/custodios/{id}/bovedas.
"""

from typing import Any

from fastapi import APIRouter, status

from app.api.dependencias import PropietarioActual, SesionBD
from app.models.custodio import Custodio
from app.schemas.custodio import (
    ConfirmarCanalCustodioRequest,
    CustodioCrearRequest,
    CustodioEditarRequest,
    CustodioResponse,
    EnlaceTelegramEnviadoResponse,
)
from app.services import custodio_service

router = APIRouter()


@router.get("", response_model=list[CustodioResponse])
def listar_custodios(
    usuario: PropietarioActual,
    db: SesionBD,
) -> list[Custodio]:
    """CU-010: consultar el directorio de custodios."""
    return custodio_service.listar_custodios(db, usuario)


@router.post("", response_model=CustodioResponse, status_code=status.HTTP_201_CREATED)
def crear_custodio(
    datos: CustodioCrearRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> Custodio:
    """CU-011: registrar un custodio y enviarle el link de verificación de correo."""
    return custodio_service.crear_custodio(db, usuario, datos)


@router.patch("/{id_custodio}", response_model=CustodioResponse)
def editar_custodio(
    id_custodio: int,
    datos: CustodioEditarRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> Custodio:
    """
    CU-012: editar datos del custodio. Si cambia el correo, queda 'no
    verificado' y se reenvía la verificación. Telegram no se edita aquí
    (tiene su propio flujo de vinculación).
    """
    return custodio_service.editar_custodio(db, usuario, id_custodio, datos)


@router.delete("/{id_custodio}", status_code=status.HTTP_200_OK)
def eliminar_custodio(
    id_custodio: int,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, str]:
    """CU-014: eliminar un custodio del directorio."""
    custodio_service.eliminar_custodio(db, usuario, id_custodio)
    return {"detail": "Custodio eliminado."}


@router.post("/{id_custodio}/reenviar-verificacion", status_code=status.HTTP_200_OK)
def reenviar_verificacion(
    id_custodio: int,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, str]:
    """Reenvía el enlace de verificación de correo (token nuevo, 72 h)."""
    custodio = custodio_service.reenviar_verificacion_correo(db, usuario, id_custodio)
    return {"detail": f"Enlace de verificación reenviado a {custodio.correo}."}


@router.post("/{id_custodio}/telegram/link-code", response_model=EnlaceTelegramEnviadoResponse)
def solicitar_vinculo_telegram_custodio(
    id_custodio: int,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """
    Dispara el envío por correo del enlace de vinculación de Telegram al
    custodio. El propietario no introduce ningún @usuario: es el propio
    custodio quien, al abrir el enlace desde su correo, interactúa con el
    bot y queda vinculado con su chat_id real.
    """
    custodio, expira_en_segundos = custodio_service.solicitar_vinculo_telegram(
        db, usuario, id_custodio
    )
    return {
        "detail": f"Enlace de vinculación de Telegram enviado a {custodio.correo}.",
        "expira_en_segundos": expira_en_segundos,
    }


@router.delete("/{id_custodio}/telegram", status_code=status.HTTP_200_OK)
def desvincular_telegram_custodio(
    id_custodio: int,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, str]:
    """Desvincula el chat de Telegram del custodio (puede volver a vincularse después)."""
    custodio_service.desvincular_telegram(db, usuario, id_custodio)
    return {"detail": "Telegram del custodio desvinculado."}


@router.post("/confirmar", status_code=status.HTTP_200_OK)
def confirmar_canal_custodio(datos: ConfirmarCanalCustodioRequest, db: SesionBD) -> dict[str, str]:
    """
    Sin autenticación: el custodio llega aquí desde el link del correo,
    sin sesión activa (mismo criterio que /canales/correo-secundario/confirmar).
    """
    custodio_service.confirmar_canal(db, datos.token)
    return {"detail": "Canal de contacto confirmado correctamente."}
