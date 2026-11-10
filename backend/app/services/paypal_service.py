# backend/app/services/paypal_service.py
"""
Cliente mínimo del REST API v2 de PayPal (Orders) para el flujo de cambio de
plan. Solo se usa cuando hay credenciales configuradas; si no, el frontend
ofrece "simular pago" y este módulo no se toca.

Flujo:  crear_orden  ->  el comprador aprueba en PayPal  ->  capturar_orden
"""

import logging
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx2

from app.core.config import settings
from app.services.errores import ErrorExterno, ServicioNoDisponible

logger = logging.getLogger(__name__)

_API = {
    "sandbox": "https://api-m.sandbox.paypal.com",
    "live": "https://api-m.paypal.com",
}

# Los ids de orden de PayPal son alfanuméricos; cualquier otra cosa (/, ?, #)
# alteraría la ruta que se consulta con el token del comercio.
_ORDER_ID_RE = re.compile(r"^[A-Za-z0-9]{8,64}$")


@dataclass
class _TokenEnCache:
    valor: str | None = None
    expira: float = 0.0  # time.time()


_cache_token = _TokenEnCache()


class PayPalNoConfigurado(ServicioNoDisponible):
    """Faltan PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET."""


class ErrorPayPal(ErrorExterno):
    """PayPal respondió con un error."""


def esta_configurado() -> bool:
    return bool(settings.PAYPAL_CLIENT_ID and settings.PAYPAL_CLIENT_SECRET)


def config_publica() -> dict[str, Any]:
    """Lo que el navegador necesita para cargar el SDK (el client-id es público)."""
    return {
        "configured": esta_configurado(),
        "client_id": settings.PAYPAL_CLIENT_ID or None,
        "currency": settings.PAYPAL_CURRENCY,
        "mode": settings.PAYPAL_MODE,
    }


def _url_base() -> str:
    return _API.get(settings.PAYPAL_MODE, _API["sandbox"])


def _fallo(operacion: str, respuesta: httpx2.Response) -> ErrorPayPal:
    # El cuerpo de PayPal (debug_id, detalles internos) se queda en el log;
    # al cliente solo le llega el código.
    logger.error("PayPal %s falló (%s): %s", operacion, respuesta.status_code, respuesta.text)
    return ErrorPayPal(f"PayPal rechazó la operación ({operacion}, HTTP {respuesta.status_code}).")


def _json(respuesta: httpx2.Response) -> dict[str, Any]:
    cuerpo = respuesta.json()
    if not isinstance(cuerpo, dict):
        raise ErrorPayPal("PayPal devolvió una respuesta inesperada.")
    return cuerpo


def order_id_valido(order_id: str) -> bool:
    return bool(_ORDER_ID_RE.match(order_id or ""))


def _exigir_order_id(order_id: str) -> None:
    if not order_id_valido(order_id):
        raise ErrorPayPal("Identificador de orden de PayPal inválido.")


def _token_acceso() -> str:
    if not esta_configurado():
        raise PayPalNoConfigurado("Configura PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET.")
    momento = time.time()
    if _cache_token.valor and _cache_token.expira > momento + 30:
        return _cache_token.valor
    respuesta = httpx2.post(
        f"{_url_base()}/v1/oauth2/token",
        auth=(settings.PAYPAL_CLIENT_ID, settings.PAYPAL_CLIENT_SECRET),
        data={"grant_type": "client_credentials"},
        timeout=20,
    )
    if respuesta.status_code != 200:
        raise _fallo("oauth", respuesta)
    cuerpo = respuesta.json()
    token = str(cuerpo["access_token"])
    _cache_token.valor = token
    _cache_token.expira = momento + int(cuerpo.get("expires_in", 300))
    return token


def _cabeceras() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_token_acceso()}",
        "Content-Type": "application/json",
    }


def crear_orden(
    *, amount: str, currency: str, reference_id: str, custom_id: str, description: str
) -> dict[str, Any]:
    datos = {
        "intent": "CAPTURE",
        "purchase_units": [
            {
                "reference_id": reference_id,
                "custom_id": custom_id,
                "description": description[:127],
                "amount": {"currency_code": currency, "value": amount},
            }
        ],
        "application_context": {
            "shipping_preference": "NO_SHIPPING",
            "user_action": "PAY_NOW",
            "brand_name": settings.MARCA[:127],
        },
    }
    respuesta = httpx2.post(
        f"{_url_base()}/v2/checkout/orders", json=datos, headers=_cabeceras(), timeout=20
    )
    if respuesta.status_code not in (200, 201):
        raise _fallo("create order", respuesta)
    return _json(respuesta)


def obtener_orden(order_id: str) -> dict[str, Any]:
    _exigir_order_id(order_id)
    respuesta = httpx2.get(
        f"{_url_base()}/v2/checkout/orders/{order_id}", headers=_cabeceras(), timeout=20
    )
    if respuesta.status_code != 200:
        raise _fallo("get order", respuesta)
    return _json(respuesta)


def capturar_orden(order_id: str) -> dict[str, Any]:
    _exigir_order_id(order_id)
    respuesta = httpx2.post(
        f"{_url_base()}/v2/checkout/orders/{order_id}/capture",
        headers=_cabeceras(),
        json={},
        timeout=30,
    )
    if respuesta.status_code not in (200, 201):
        raise _fallo("capture", respuesta)
    return _json(respuesta)


def unidad_de_compra(orden: dict[str, Any]) -> dict[str, Any] | None:
    """Primera (y única) unidad de compra de la orden, o None si no viene."""
    try:
        unidad = orden["purchase_units"][0]
    except (KeyError, IndexError, TypeError):
        return None
    return unidad if isinstance(unidad, dict) else None
