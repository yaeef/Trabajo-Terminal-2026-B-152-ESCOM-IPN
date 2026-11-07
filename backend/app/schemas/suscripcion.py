# backend/app/schemas/suscripcion.py
from datetime import date, datetime

from pydantic import BaseModel


class PlanResponse(BaseModel):
    """Un plan del catálogo (`suscripcion`)."""

    id: int
    nombre: str
    costo_anual: float  # único ciclo de facturación; 0 = gratuito
    max_almacenamiento_gb: int
    max_bovedas: int
    max_custodios: int


class UsoActual(BaseModel):
    """Consumo real del propietario, para comparar contra los límites del plan."""

    bovedas: int
    custodios: int
    almacenamiento_bytes: int


class PlanActualResponse(BaseModel):
    plan: PlanResponse
    fecha_inicio: date
    # Día en que deja de estar vigente; None = sin caducidad (plan gratuito).
    fecha_fin: date | None = None
    # Si no es None, el propietario canceló: no renovará y al llegar
    # fecha_fin pasa a Gratuito.
    cancelada_en: datetime | None = None
    uso: UsoActual


class CambiarPlanRequest(BaseModel):
    plan_id: int


class PagoIniciadoResponse(BaseModel):
    """Orden de PayPal recién creada; el navegador la aprueba con el SDK."""

    order_id: str
    status: str


class ConfigPayPalResponse(BaseModel):
    configured: bool
    client_id: str | None = None
    currency: str
    mode: str
