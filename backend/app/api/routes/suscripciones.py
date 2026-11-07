# backend/app/api/routes/suscripciones.py
"""Plan del propietario: catálogo, plan vigente, cambio, cancelación y pago con PayPal."""

from typing import Any

from fastapi import APIRouter

from app.api.dependencias import PropietarioActual, SesionBD
from app.schemas.suscripcion import (
    CambiarPlanRequest,
    ConfigPayPalResponse,
    PagoIniciadoResponse,
    PlanActualResponse,
    PlanResponse,
)
from app.services import paypal_service, suscripcion_service

router = APIRouter()


@router.get("/planes", response_model=list[PlanResponse])
def listar_planes(
    usuario: PropietarioActual,
    db: SesionBD,
) -> list[dict[str, Any]]:
    """Catálogo de planes disponibles."""
    return suscripcion_service.listar_planes(db)


@router.get("/actual", response_model=PlanActualResponse)
def plan_actual(
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """Plan activo del propietario + consumo real (bóvedas, custodios, almacenamiento)."""
    return suscripcion_service.obtener_estado(db, usuario)


@router.get("/paypal/config", response_model=ConfigPayPalResponse)
def config_paypal(usuario: PropietarioActual) -> dict[str, Any]:
    """Datos públicos para que el navegador cargue el SDK de PayPal. Si
    `configured` es false, el frontend ofrece 'simular pago'."""
    return paypal_service.config_publica()


@router.post("/cambiar", response_model=PlanActualResponse)
def cambiar_plan(
    datos: CambiarPlanRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """Cambio directo, SIN pasarela. Válido para planes sin costo o el modo
    'simular pago' cuando PayPal no está configurado; con PayPal configurado,
    un cambio que requiere pago se rechaza (409). Bajar desde un plan de pago
    también (409): se hace con /cancelar. También 409 si el uso actual excede
    los límites del plan destino."""
    return suscripcion_service.cambiar_plan(db, usuario, datos.plan_id)


@router.post("/cancelar", response_model=PlanActualResponse)
def cancelar(usuario: PropietarioActual, db: SesionBD) -> dict[str, Any]:
    """El plan de pago NO se quita en el acto: sigue vigente hasta `fecha_fin`
    y después pasa a Gratuito. 409 si el plan vigente no es de pago."""
    return suscripcion_service.cancelar(db, usuario)


@router.post("/reactivar", response_model=PlanActualResponse)
def reactivar(usuario: PropietarioActual, db: SesionBD) -> dict[str, Any]:
    """Deshace la cancelación mientras el plan de pago siga vigente."""
    return suscripcion_service.reactivar(db, usuario)


# --------------------------------------------------------------------------
# Flujo de pago PayPal (Orders v2): create order -> aprobar -> capture
# --------------------------------------------------------------------------
@router.post("/checkout", response_model=PagoIniciadoResponse)
def iniciar_pago_paypal(
    datos: CambiarPlanRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """Paso 1: valida el cambio y crea la orden de PayPal por el importe anual del plan."""
    return suscripcion_service.iniciar_pago(db, usuario, datos.plan_id)


@router.post("/checkout/{order_id}/capturar", response_model=PlanActualResponse)
def capturar(
    order_id: str,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """Paso 2: tras la aprobación del comprador, captura el pago y aplica el
    cambio de plan (ver `suscripcion_service.capturar_pago`)."""
    return suscripcion_service.capturar_pago(db, usuario, order_id)
