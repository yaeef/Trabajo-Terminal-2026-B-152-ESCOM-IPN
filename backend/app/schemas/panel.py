# backend/app/schemas/panel.py
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.models.usuario import EstadoDMS


class PanelBoveda(BaseModel):
    id: int
    pid: str
    nombre: str
    categoria: str | None = None
    umbral_k: int | None = None
    total_fragmentos_n: int | None = None
    estado: str
    custodios_vinculados: int
    badge: Literal["protegida", "incompleta", "borrador"]
    created_at: datetime | None = None


class PanelProtocolo(BaseModel):
    periodicidad_prueba: int | None = None
    periodicidad_periodo_gracia: int | None = None
    ultima_prueba: datetime | None = None
    status_dms: EstadoDMS


class PanelResponse(BaseModel):
    """Resumen para la vista principal (Dashboard) en una sola llamada."""

    bovedas_total: int
    bovedas_por_estado: dict[str, int]
    bovedas_protegidas: int
    custodios_total: int
    usado_bytes: int
    cuota_bytes: int
    protocolo_vida: PanelProtocolo
    bovedas: list[PanelBoveda]
