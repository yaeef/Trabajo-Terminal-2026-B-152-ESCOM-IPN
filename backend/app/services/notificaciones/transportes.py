"""
Entrega física de un mensaje ya renderizado: SMTP (Mailpit en desarrollo) y
la Bot API de Telegram. No saben nada de plantillas ni de la cola.

Lanzan `ErrorTemporal` si vale la pena reintentar (red, servidor caído,
límite de tasa) y `ErrorPermanente` si no (destinatario rechazado, chat
inexistente o bot bloqueado, transporte sin configurar).
"""

import logging
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

import httpx2

from app.core.config import settings

logger = logging.getLogger("b152.notificaciones")


class ErrorDeEnvio(Exception):
    """Base: el mensaje no salió."""


class ErrorTemporal(ErrorDeEnvio):
    pass


class ErrorPermanente(ErrorDeEnvio):
    pass


def _asunto_seguro(asunto: str) -> str:
    """Un asunto nunca lleva saltos de línea (inyección de cabeceras)."""
    return re.sub(r"[\r\n]+", " ", asunto).strip()


def enviar_correo(destino: str, asunto: str, html: str) -> None:
    mensaje = EmailMessage()
    mensaje["Subject"] = _asunto_seguro(asunto)
    mensaje["From"] = formataddr((settings.MARCA, settings.SMTP_FROM_EMAIL))
    mensaje["To"] = destino
    mensaje.set_content(html, subtype="html", charset="utf-8")

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as servidor:
            if settings.SMTP_USE_TLS:
                # Sin contexto explícito, starttls() no valida el certificado
                # del servidor (MITM trivial sobre las credenciales SMTP).
                servidor.starttls(context=ssl.create_default_context())
            if settings.SMTP_USERNAME:
                servidor.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            servidor.send_message(mensaje)
    except smtplib.SMTPRecipientsRefused as exc:
        raise ErrorPermanente("SMTP rechazó el destinatario") from exc
    except smtplib.SMTPResponseException as exc:
        # 5xx = rechazo definitivo; 4xx = intentar más tarde.
        tipo = ErrorPermanente if 500 <= exc.smtp_code < 600 else ErrorTemporal
        raise tipo(f"SMTP respondió {exc.smtp_code}") from exc
    except (smtplib.SMTPException, OSError) as exc:
        raise ErrorTemporal(f"SMTP no disponible ({type(exc).__name__})") from exc


def enviar_telegram(chat_id: str, texto: str) -> None:
    """
    Texto plano (sin parse_mode): los mensajes llevan nombres escritos por
    usuarios y así no hay marcado que inyectar. Los errores NUNCA incluyen
    el texto de la excepción de httpx2: lleva la URL, y la URL lleva el
    token del bot (https://api.telegram.org/bot<TOKEN>/...).
    """
    if not settings.TELEGRAM_BOT_TOKEN:
        raise ErrorPermanente("Telegram no está configurado")
    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
    cuerpo = {"chat_id": chat_id, "text": texto, "disable_web_page_preview": True}
    try:
        respuesta = httpx2.post(url, json=cuerpo, timeout=10)
    except httpx2.HTTPError as exc:
        raise ErrorTemporal(f"Telegram no disponible ({type(exc).__name__})") from None
    if respuesta.status_code == 429 or respuesta.status_code >= 500:
        raise ErrorTemporal(f"Telegram respondió HTTP {respuesta.status_code}")
    if respuesta.is_error:
        raise ErrorPermanente(f"Telegram respondió HTTP {respuesta.status_code}")
