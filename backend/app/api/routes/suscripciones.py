# backend/app/api/routes/suscripciones.py
"""Plan del propietario: catálogo, cobertura, compras (plan anual y año de
reserva) con PayPal o simuladas, avisos de renovación y elección de la
bóveda que se conserva si su plan venció."""

from typing import Any

from fastapi import APIRouter

from app.api.dependencias import PropietarioActual, SesionBD
from app.schemas.suscripcion import (
    CompraRequest,
    ConfigPayPalResponse,
    ConservarBovedaRequest,
    PagoIniciadoResponse,
    PlanActualResponse,
    PlanResponse,
)
from app.services import impago, paypal_service, suscripcion_service

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
    """Plan y cobertura de hoy, consumo, renovación, año de reserva e impago."""
    return suscripcion_service.obtener_estado(db, usuario)


@router.get("/paypal/config", response_model=ConfigPayPalResponse)
def config_paypal(usuario: PropietarioActual) -> dict[str, Any]:
    """Datos públicos para que el navegador cargue el SDK de PayPal. Si
    `configured` es false, el frontend ofrece 'simular pago' (/comprar)."""
    return paypal_service.config_publica()


@router.post("/comprar", response_model=PlanActualResponse)
def comprar_simulado(
    datos: CompraRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """Compra SIN pasarela, solo si PayPal no está configurado (pruebas). Con
    PayPal configurado responde 409: se paga por /checkout."""
    return suscripcion_service.comprar_simulado(
        db, usuario, datos.plan_id, datos.incluye_plan, datos.incluye_reserva
    )


@router.post("/cancelar", response_model=PlanActualResponse)
def cancelar(usuario: PropietarioActual, db: SesionBD) -> dict[str, Any]:
    """Deja de recibir los avisos de renovación (la renovación es manual: no
    hay cobro que detener). 409 si no tiene un año pagado vigente."""
    return suscripcion_service.cancelar(db, usuario)


@router.post("/reactivar", response_model=PlanActualResponse)
def reactivar(usuario: PropietarioActual, db: SesionBD) -> dict[str, Any]:
    """Vuelve a recibir los avisos de renovación."""
    return suscripcion_service.reactivar(db, usuario)


@router.put("/impago/boveda-conservar", response_model=PlanActualResponse)
def elegir_boveda_conservar(
    datos: ConservarBovedaRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """Con el plan vencido, qué bóveda se conserva si llega el recorte."""
    impago.elegir_boveda_conservar(db, usuario, datos.id_boveda)
    return suscripcion_service.obtener_estado(db, usuario)


# --------------------------------------------------------------------------
# Flujo de pago PayPal (Orders v2): create order -> aprobar -> capture
# --------------------------------------------------------------------------
@router.post("/checkout", response_model=PagoIniciadoResponse)
def iniciar_pago_paypal(
    datos: CompraRequest,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """Paso 1: valida la compra y crea la orden de PayPal por su importe."""
    return suscripcion_service.iniciar_pago(
        db, usuario, datos.plan_id, datos.incluye_plan, datos.incluye_reserva
    )


@router.post("/checkout/{order_id}/capturar", response_model=PlanActualResponse)
def capturar(
    order_id: str,
    usuario: PropietarioActual,
    db: SesionBD,
) -> dict[str, Any]:
    """Paso 2: tras la aprobación del comprador, captura el pago y aplica la
    compra (ver `suscripcion_service.capturar_pago`)."""
    return suscripcion_service.capturar_pago(db, usuario, order_id)
