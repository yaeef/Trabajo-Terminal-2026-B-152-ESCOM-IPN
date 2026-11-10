"""
Plantillas Jinja2 de los avisos (`plantillas/correo/*.html` y
`plantillas/telegram/*.txt`).

- HTML con autoescape: todo dato que viene de un usuario (nombres de
  propietario, custodio o bóveda) llega como texto, nunca como marcado. Sin
  eso, cualquiera podía registrarse con un "nombre" que fuera HTML (un enlace
  de phishing, p. ej.) y el sistema lo entregaba con remitente legítimo.
- `StrictUndefined`: una variable faltante es un error, no un hueco en blanco.
- El nombre de la plantilla es el mismo en ambos canales cuando el aviso
  existe en los dos (p. ej. `dms_gracia`).
"""

import base64
import io
from functools import cache
from pathlib import Path
from typing import Any

import qrcode
from jinja2 import Environment, FileSystemLoader, StrictUndefined, Template

from app.core.config import settings

_DIR = Path(__file__).parent / "plantillas"

# Colores de marca (los de frontend/src/pages/auth/AuthTheme.css): en HTML de
# correo no hay variables CSS, así que se repiten aquí.
COLORES = {
    "guinda": "#621132",
    "azul": "#003366",
    "texto": "#2d3436",
    "gris_suave": "#f4f7f6",
    "gris_tenue": "#64748b",
}

# Asunto sin la marca: `_asunto` le agrega " — <MARCA>" a todos.
ASUNTOS: dict[str, str] = {
    "recuperacion": "Recuperación de contraseña",
    "correo_secundario": "Confirma tu correo alternativo",
    "confirmacion_registro": "Confirma tu correo para activar tu cuenta",
    "custodio_verificacion": "Confirma que eres custodio",
    "custodio_telegram": "Vincula tu Telegram como custodio",
    "eliminacion_programada": "Tu cuenta se eliminará pronto",
    "eliminacion_recordatorio": "Recordatorio: tu cuenta se eliminará pronto",
    "eliminacion_cancelada": "Cancelaste la eliminación de tu cuenta",
    "dms_alerta": "Confirma tu actividad — Interruptor de Hombre Muerto",
    "dms_gracia": "Periodo de gracia iniciado — Interruptor de Hombre Muerto",
    "dms_gracia_reduccion": "Confirma tu vida antes del plazo — Interruptor de Hombre Muerto",
    "dms_liberado": "Tu Interruptor de Hombre Muerto se activó",
    "dms_reactivado": "Interruptor de Hombre Muerto reactivado",
    "dms_alerta_custodio": "Sin señales de {{ propietario }}",
    "dms_voto_custodio": "Confirma la situación de {{ propietario }}",
    "dms_liberado_custodio": "Recuperación habilitada — {{ propietario }}",
    "plan_renovacion": ("Tu plan vence {{ 'mañana' if dias == 1 else 'en ' ~ dias ~ ' días' }}"),
    "plan_gracia": "Tu plan venció: periodo de gracia hasta el {{ hasta }}",
    "plan_reserva_activa": "Tu año de reserva está en uso",
    "plan_impago": (
        "{% if motivo == 'recordatorio' %}Quedan {{ dias }} día(s): lo{% else %}Lo{% endif %}"
        " que excede tu plan se eliminará el {{ recorte_en }}"
    ),
    "plan_recorte": "Eliminamos lo que excedía tu plan",
}

PLANTILLAS_TELEGRAM = frozenset(p.stem for p in (_DIR / "telegram").glob("*.txt"))


def _qr_data_uri(url: str) -> str:
    """PNG del QR embebido como data URI: sin depender de un host externo
    para la imagen (lo soportan todos los clientes de correo relevantes)."""
    imagen = qrcode.make(url, box_size=5, border=2)
    buffer = io.BytesIO()
    imagen.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _url_login() -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/login"


def _entorno(*, html: bool) -> Environment:
    entorno = Environment(
        loader=FileSystemLoader(_DIR),
        autoescape=html,
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
        auto_reload=False,
    )
    entorno.globals.update(color=COLORES, url_login=_url_login, marca=settings.MARCA)
    entorno.filters["qr"] = _qr_data_uri
    return entorno


_HTML = _entorno(html=True)
_TEXTO = _entorno(html=False)


@cache
def _asunto(plantilla: str) -> Template:
    return _TEXTO.from_string(f"{ASUNTOS[plantilla]} — {settings.MARCA}")


def existe_correo(plantilla: str) -> bool:
    return plantilla in ASUNTOS


def existe_telegram(plantilla: str) -> bool:
    return plantilla in PLANTILLAS_TELEGRAM


def correo(plantilla: str, datos: dict[str, Any]) -> tuple[str, str]:
    """(asunto, html)."""
    asunto = _asunto(plantilla).render(**datos)
    return asunto, _HTML.get_template(f"correo/{plantilla}.html").render(**datos)


def telegram(plantilla: str, datos: dict[str, Any]) -> str:
    return _TEXTO.get_template(f"telegram/{plantilla}.txt").render(**datos).strip()
