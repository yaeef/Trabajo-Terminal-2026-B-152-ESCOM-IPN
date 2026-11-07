# backend/app/schemas/admin.py
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr

from app.models.admin_auditoria import AccionAdmin
from app.models.notificacion import CanalNotificacion, EstadoNotificacion
from app.models.usuario import EstadoDMS
from app.schemas.comunes import TextoRecortado, texto_acotado
from app.schemas.dms import LiberacionResumenResponse


def _motivo(v: str) -> str:
    return texto_acotado(v, "El motivo", 5, 500)


def _dias_extension(v: int) -> int:
    if not (1 <= v <= 90):
        raise ValueError("dias debe estar entre 1 y 90.")
    return v


Motivo = Annotated[TextoRecortado, AfterValidator(_motivo)]
DiasExtension = Annotated[int, AfterValidator(_dias_extension)]


class AccionAdminRequest(BaseModel):
    """Toda acción admin que modifica datos exige justificar el motivo; queda
    registrado en `admin_auditoria` (ver services/admin/auditoria.py)."""

    motivo: Motivo


class ExtenderPlazoRequest(AccionAdminRequest):
    dias: DiasExtension


class CambiarPlanAdminRequest(AccionAdminRequest):
    id_plan: int


class PurgarCuentaAdminRequest(AccionAdminRequest):
    """Acción irreversible: además del motivo, exige la contraseña del
    propio admin (no la del propietario) para confirmarla."""

    contrasena_admin: str


# --------------------------------------------------------------------------
# Respuestas
# --------------------------------------------------------------------------
class PropietarioListaItem(BaseModel):
    id: int
    username: str
    nombre: str
    correo: EmailStr
    created_at: datetime | None = None
    status_dms: EstadoDMS | None = None
    plan_nombre: str
    eliminacion_solicitada_en: datetime | None = None


class PropietariosListaResponse(BaseModel):
    total: int
    pagina: int
    tam_pagina: int
    resultados: list[PropietarioListaItem]


class PropietarioDetalleResponse(BaseModel):
    id: int
    username: str
    nombre: str
    correo: EmailStr
    created_at: datetime | None = None
    status_dms: EstadoDMS | None = None
    eliminacion_solicitada_en: datetime | None = None
    eliminacion_purga_en: datetime | None = None
    plan_nombre: str
    bovedas_total: int
    custodios_total: int
    usado_bytes: int
    cuota_bytes: int


class DmsVotoConteo(BaseModel):
    vida: int
    fallecimiento: int


class DmsEstadoResponse(BaseModel):
    status_dms: EstadoDMS
    dms_ronda: int
    dms_quorum: int | None = None
    dms_reconfirmaciones: int
    dms_alerta_en: datetime | None = None
    dms_gracia_en: datetime | None = None
    dms_reduccion_hasta: datetime | None = None
    dms_ultimo_aviso: datetime | None = None
    votos: DmsVotoConteo
    resumen_liberacion: LiberacionResumenResponse


class BarridoResultado(BaseModel):
    transicion: str | None = None


class NotificacionItem(BaseModel):
    """Fila de la cola, sin `datos_cifrados` — ni cifrados se exponen."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    canal: CanalNotificacion
    destino: str
    plantilla: str
    estado: EstadoNotificacion
    intentos: int
    siguiente_intento_en: datetime
    ultimo_error: str | None = None
    creada_en: datetime
    enviada_en: datetime | None = None


class NotificacionesListaResponse(BaseModel):
    total: int
    resultados: list[NotificacionItem]


class ReintentoNotificacionesResponse(BaseModel):
    enviadas: int


class AuditoriaItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    id_admin: int
    id_propietario_afectado: int | None = None
    accion: AccionAdmin
    motivo: str
    creado_en: datetime


class AuditoriaListaResponse(BaseModel):
    total: int
    resultados: list[AuditoriaItem]


__all__ = [
    "AccionAdminRequest",
    "AuditoriaItem",
    "AuditoriaListaResponse",
    "BarridoResultado",
    "CambiarPlanAdminRequest",
    "DmsEstadoResponse",
    "DmsVotoConteo",
    "ExtenderPlazoRequest",
    "Motivo",
    "NotificacionItem",
    "NotificacionesListaResponse",
    "PropietarioDetalleResponse",
    "PropietarioListaItem",
    "PropietariosListaResponse",
    "PurgarCuentaAdminRequest",
    "ReintentoNotificacionesResponse",
]
