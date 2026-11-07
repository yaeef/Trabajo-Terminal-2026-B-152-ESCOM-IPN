# backend/app/api/routes/bovedas.py
"""
Bóvedas y compromisos Feldman VSS (CU-019 a CU-023, CU-027, CU-028).

Ningún endpoint recibe la llave maestra ni los valores `y` de los
fragmentos: el navegador ejecuta sss.split() (WASM) y aquí solo se suben
los compromisos públicos + n/k + las coordenadas x.
"""

from typing import Any

from fastapi import APIRouter, status

from app.api.dependencias import PropietarioActual, SesionBD
from app.schemas.boveda import (
    AsignacionesRequest,
    AsignacionResponse,
    BovedaCrearRequest,
    BovedaEditarRequest,
    BovedaEliminarRequest,
    BovedaResponse,
    CompromisosVssRequest,
    CompromisosVssResponse,
    VerificarPassphraseRequest,
)
from app.services import boveda_service

router = APIRouter()


# --------------------------------------------------------------------------
# CRUD de bóvedas
# --------------------------------------------------------------------------


@router.get("", response_model=list[BovedaResponse])
def listar_bovedas(
    usuario: PropietarioActual,
    db: SesionBD,
) -> list[dict[str, Any]]:
    """CU-019: 'Mis Bóvedas'."""
    return boveda_service.listar_bovedas(db, usuario)


@router.post("", response_model=BovedaResponse, status_code=status.HTTP_201_CREATED)
def crear_boveda(
    datos: BovedaCrearRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """CU-020, Paso 1: crea la bóveda (estado 'borrador')."""
    boveda = boveda_service.crear_boveda(db, usuario, datos)
    return boveda_service.serializar_boveda(db, boveda, usuario)


@router.get("/{id_boveda}", response_model=BovedaResponse)
def obtener_boveda(
    id_boveda: int,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """CU-023: gestionar bóveda."""
    boveda = boveda_service.obtener_boveda_propia(db, usuario, id_boveda)
    return boveda_service.serializar_boveda(db, boveda, usuario)


@router.patch("/{id_boveda}", response_model=BovedaResponse)
def editar_boveda(
    id_boveda: int,
    datos: BovedaEditarRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    boveda = boveda_service.editar_boveda(db, usuario, id_boveda, datos)
    return boveda_service.serializar_boveda(db, boveda, usuario)


@router.post("/{id_boveda}/passphrase/verify", response_model=BovedaResponse)
def verificar_passphrase(
    id_boveda: int,
    datos: VerificarPassphraseRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """
    CU-027 'Confirmar Llave maestra': guardia previa a operaciones críticas.
    200 + datos de la bóveda si la pass-phrase es correcta; 403 si no.
    """
    boveda = boveda_service.verificar_passphrase(db, usuario, id_boveda, datos.passphrase_verifier)
    return boveda_service.serializar_boveda(db, boveda, usuario)


@router.delete("/{id_boveda}", status_code=status.HTTP_200_OK)
def eliminar_boveda(
    id_boveda: int,
    datos: BovedaEliminarRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, str]:
    """CU-028. Requiere la contraseña de la cuenta (no la pass-phrase de la bóveda)."""
    boveda_service.eliminar_boveda(db, usuario, id_boveda, datos.password)
    return {"detail": "Bóveda eliminada."}


# --------------------------------------------------------------------------
# Compromisos Feldman VSS
# --------------------------------------------------------------------------


@router.put("/{id_boveda}/vss", response_model=BovedaResponse)
def cargar_vss(
    id_boveda: int,
    datos: CompromisosVssRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """
    CU-021, Paso 2 (cola): sube los compromisos públicos que produjo
    sss.split() en el navegador. Fija n/k y pasa la bóveda a 'activa'.
    """
    boveda = boveda_service.cargar_vss(db, usuario, id_boveda, datos)
    return boveda_service.serializar_boveda(db, boveda, usuario)


@router.get("/{id_boveda}/vss", response_model=CompromisosVssResponse)
def obtener_vss(
    id_boveda: int,
    usuario: PropietarioActual,
    db: SesionBD,
) -> CompromisosVssResponse:
    """
    Compromisos públicos para verificar fragmentos en el cliente. Solo para
    el propietario dueño; el portal de recuperación los obtiene por PID
    (GET /recuperacion/bovedas/{pid}).
    """
    boveda, vss = boveda_service.obtener_vss(db, usuario, id_boveda)
    # Con compromisos cargados, n y k siempre están fijados (ver cargar_vss).
    assert boveda.total_fragmentos_n is not None and boveda.umbral_k is not None
    return CompromisosVssResponse(
        n=boveda.total_fragmentos_n,
        k=boveda.umbral_k,
        commitments_hex=vss.commitments_hex,
        x_coords=vss.x_coords,
    )


# --------------------------------------------------------------------------
# Vinculación de custodios (CU-022, Paso 3)
# --------------------------------------------------------------------------


@router.get("/{id_boveda}/custodios", response_model=list[AsignacionResponse])
def listar_custodios_boveda(
    id_boveda: int,
    usuario: PropietarioActual,
    db: SesionBD,
) -> list[dict[str, Any]]:
    return boveda_service.listar_asignaciones(db, usuario, id_boveda)


@router.put("/{id_boveda}/custodios", response_model=list[AsignacionResponse])
def reemplazar_custodios_boveda(
    id_boveda: int,
    datos: AsignacionesRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> list[dict[str, Any]]:
    """
    vincular.html Paso 3: confirma de una sola vez el conjunto completo de
    custodios de la bóveda (reemplaza las vinculaciones anteriores).
    """
    return boveda_service.reemplazar_asignaciones(
        db, usuario, id_boveda, datos.asignaciones, datos.passphrase_verifier
    )
