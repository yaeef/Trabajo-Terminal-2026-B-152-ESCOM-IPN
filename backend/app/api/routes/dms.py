# backend/app/api/routes/dms.py
"""Panel del propietario y su protocolo de vida (Interruptor de Hombre Muerto)."""

from typing import Any

from fastapi import APIRouter

from app.api.dependencias import PropietarioActual, SesionBD
from app.models.usuario import Propietario
from app.schemas.dms import LiberacionResumenResponse
from app.schemas.panel import PanelResponse
from app.schemas.usuario import (
    HistorialCheckinsResponse,
    ProtocoloVidaRequest,
    ProtocoloVidaResponse,
)
from app.services import dms, panel_service

router = APIRouter()


@router.get("/dashboard", response_model=PanelResponse)
def leer_panel(
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """Resumen para la vista principal: totales, uso de espacio, protocolo de
    vida e inventario de bóvedas — todo en una llamada."""
    return panel_service.construir_resumen(db, usuario)


@router.get("/protocolo-vida", response_model=ProtocoloVidaResponse)
def leer_protocolo_vida(usuario: PropietarioActual) -> Propietario | None:
    """CU-015: umbral de inactividad, periodo de gracia, última señal y estado."""
    return usuario.propietario


@router.patch("/protocolo-vida", response_model=ProtocoloVidaResponse)
def cambiar_protocolo_vida(
    datos: ProtocoloVidaRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> Propietario:
    """CU-015: cambia el umbral de inactividad y el periodo de gracia."""
    return dms.actualizar_protocolo_vida(db, usuario, datos)


@router.get("/checkins", response_model=HistorialCheckinsResponse)
def leer_checkins(usuario: PropietarioActual, db: SesionBD) -> HistorialCheckinsResponse:
    """Historial de check-ins (pruebas de vida) con las estadísticas del interruptor."""
    return dms.historial_checkins(db, usuario)


@router.get("/liberacion-resumen", response_model=LiberacionResumenResponse)
def leer_resumen_liberacion(
    usuario: PropietarioActual,
    db: SesionBD,
) -> LiberacionResumenResponse:
    """Aviso post-login cuando el patrimonio ya se liberó: motivo y votos de
    los custodios que llevaron a la liberación. `liberado=False` si no aplica."""
    return dms.resumen_liberacion(db, usuario)
