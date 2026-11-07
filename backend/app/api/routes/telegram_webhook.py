# backend/app/api/routes/telegram_webhook.py
"""Webhook del bot de Telegram: vincula chats con el comando /start <código>."""

import hmac
from typing import Annotated, Any

from fastapi import APIRouter, Body, Header, HTTPException, status

from app.api.dependencias import SesionBD
from app.core.config import settings
from app.services import telegram_service

router = APIRouter()


def _firma_valida(recibida: str | None) -> bool:
    """
    Fail-closed: sin TELEGRAM_WEBHOOK_SECRET configurado el webhook no acepta
    nada (antes, con el secreto vacío, se aceptaban updates de cualquiera).
    Comparación en tiempo constante.
    """
    esperada = settings.TELEGRAM_WEBHOOK_SECRET
    if not esperada or not recibida:
        return False
    return hmac.compare_digest(recibida.encode(), esperada.encode())


@router.post("/webhook", status_code=status.HTTP_200_OK)
def telegram_webhook(
    actualizacion: Annotated[dict[str, Any], Body()],
    db: SesionBD,
    x_telegram_bot_api_secret_token: Annotated[str | None, Header()] = None,
) -> dict[str, bool]:
    """
    Telegram llama aquí en cada mensaje que el bot recibe. No lleva
    autenticación de usuario (Telegram no manda un JWT) — la protección
    es el secret_token configurado al registrar el webhook, que Telegram
    reenvía en este header en cada request.

    Es `def` (no `async`): la BD es bloqueante, así FastAPI la corre en su
    threadpool en vez de frenar el event loop. Las respuestas del bot se
    encolan y salen en cuanto se confirma la petición.
    """
    if not _firma_valida(x_telegram_bot_api_secret_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Firma de webhook inválida."
        )

    mensaje = actualizacion.get("message") or actualizacion.get("edited_message")
    if not isinstance(mensaje, dict):
        return {"ok": True}  # ignora otros tipos de update (ej. callback_query)

    chat_id = (mensaje.get("chat") or {}).get("id")
    texto = mensaje.get("text")
    if chat_id is None or not isinstance(texto, str):
        return {"ok": True}

    if texto.startswith("/start"):
        partes = texto.split(maxsplit=1)
        if len(partes) == 2:
            telegram_service.procesar_start(db, chat_id, partes[1])
        else:
            telegram_service.responder_sin_codigo(db, chat_id)

    return {"ok": True}
