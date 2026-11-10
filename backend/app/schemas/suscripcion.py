# backend/app/schemas/suscripcion.py
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class PlanResponse(BaseModel):
    """Un plan del catálogo (`suscripcion`)."""

    id: int
    nombre: str
    costo_anual: float  # único ciclo de facturación; 0 = gratuito
    costo_reserva: float  # año de reserva; 0 = el plan no lo ofrece
    max_almacenamiento_gb: int
    max_bovedas: int
    max_custodios: int


class UsoActual(BaseModel):
    """Consumo real del propietario, para comparar contra los límites del plan."""

    bovedas: int
    custodios: int
    almacenamiento_bytes: int


class ReservaEstado(BaseModel):
    """Año de reserva sin consumir."""

    estado: Literal["disponible", "activa"]
    # Periodo que cubrirá (o cubre) si no renueva; None si aún no está agendado.
    cubre_desde: date | None = None
    cubre_hasta: date | None = None


class ImpagoEstado(BaseModel):
    """Plan vencido con contenido que excede el Gratuito."""

    estado: Literal["abierto", "pausado"]  # pausado: el DMS no está activo, no se borra nada
    inicio: date  # día en que terminó la cobertura de pago
    recorte_en: date
    id_boveda_conservar: int | None = None
    excesos: list[str]  # lo que se borraría (vacío si ya cabe)


class PlanActualResponse(BaseModel):
    plan: PlanResponse
    fecha_inicio: date
    # Día en que termina el periodo que cubre hoy; None = sin caducidad (Gratuito).
    fecha_fin: date | None = None
    # No quiere renovar: no recibe avisos de renovación (solo con cobertura 'pago').
    cancelada_en: datetime | None = None
    uso: UsoActual
    # gratuito | pago (año pagado) | gracia (venció, con reserva) | reserva (la reserva cubre)
    cobertura: Literal["gratuito", "pago", "gracia", "reserva"]
    pagado_hasta: date | None = None  # fin del último año pagado (incluye una renovación)
    puede_renovar: bool  # si hoy puede pagar el plan (contratar o renovar)
    renovable_desde: date | None = None  # si aún no puede renovar, desde cuándo
    reserva: ReservaEstado | None = None
    impago: ImpagoEstado | None = None


class CompraRequest(BaseModel):
    """Un año del plan, el año de reserva, o ambos en una sola orden."""

    plan_id: int
    incluye_plan: bool = True
    incluye_reserva: bool = False


class ConservarBovedaRequest(BaseModel):
    id_boveda: int | None = None  # None = que decida la regla por defecto


class PagoIniciadoResponse(BaseModel):
    """Orden de PayPal recién creada; el navegador la aprueba con el SDK."""

    order_id: str
    status: str


class ConfigPayPalResponse(BaseModel):
    configured: bool
    client_id: str | None = None
    currency: str
    mode: str
