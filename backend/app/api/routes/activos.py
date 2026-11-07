# backend/app/api/routes/activos.py
"""
Activos digitales de una bóveda (CU-024 a CU-026).

Montado bajo /api/v1/bovedas. Ningún endpoint recibe ni devuelve texto
plano: el navegador cifra/descifra y sube/baja DIRECTO a Blob Storage con
los SAS que emite este módulo.
"""

from typing import Any

from fastapi import APIRouter, status

from app.api.dependencias import PropietarioActual, SesionBD
from app.models.activo import ActivoDigital
from app.schemas.activo import (
    ActivoResponse,
    DescargaResponse,
    IniciarSubidaRequest,
    IniciarSubidaResponse,
    SoloPassphraseRequest,
)
from app.services import activo_service

router = APIRouter()


@router.get("/{id_boveda}/activos", response_model=list[ActivoResponse])
def listar_activos(
    id_boveda: int,
    usuario: PropietarioActual,
    db: SesionBD,
) -> list[ActivoDigital]:
    """CU-026 (listado): solo metadatos en claro; no pide la pass-phrase."""
    return activo_service.listar(db, usuario, id_boveda)


@router.post(
    "/{id_boveda}/activos/iniciar",
    response_model=IniciarSubidaResponse,
    status_code=status.HTTP_201_CREATED,
)
def iniciar_subida(
    id_boveda: int,
    datos: IniciarSubidaRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """CU-024 paso 1: valida pass-phrase + cuota, devuelve un SAS de escritura."""
    return activo_service.iniciar_subida(db, usuario, id_boveda, datos)


@router.post("/{id_boveda}/activos/{id_activo}/confirmar", response_model=ActivoResponse)
def confirmar_subida(
    id_boveda: int,
    id_activo: int,
    datos: SoloPassphraseRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> ActivoDigital:
    """CU-024 paso 3: el navegador ya subió el blob; se marca 'activo'."""
    return activo_service.confirmar_subida(
        db, usuario, id_boveda, id_activo, datos.passphrase_verifier
    )


@router.post("/{id_boveda}/activos/{id_activo}/descarga", response_model=DescargaResponse)
def preparar_descarga(
    id_boveda: int,
    id_activo: int,
    datos: SoloPassphraseRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """CU-026: SAS de lectura + iv para que el navegador baje y descifre."""
    return activo_service.preparar_descarga(
        db, usuario, id_boveda, id_activo, datos.passphrase_verifier
    )


@router.delete("/{id_boveda}/activos/{id_activo}", status_code=status.HTTP_200_OK)
def eliminar_activo(
    id_boveda: int,
    id_activo: int,
    datos: SoloPassphraseRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, str]:
    """CU-025: borra el blob y la fila. Requiere la pass-phrase de la bóveda."""
    activo_service.eliminar(db, usuario, id_boveda, id_activo, datos.passphrase_verifier)
    return {"detail": "Activo eliminado."}
