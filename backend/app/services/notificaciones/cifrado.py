"""
Cifrado de los parámetros de una notificación mientras espera en la cola.

Los datos de una plantilla llevan enlaces con tokens de un solo uso y datos
personales; en la tabla `notificacion` solo existen cifrados (Fernet:
AES-128-CBC + HMAC-SHA256) y se borran en cuanto el aviso sale o se da por
perdido. La llave se deriva de SECRET_KEY con HKDF y una etiqueta propia,
así no se reutiliza la misma llave que firma los JWT.
"""

import base64
import json
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

_ETIQUETA = b"b152-notificaciones"


@lru_cache(maxsize=2)
def _fernet(secreto: str) -> Fernet:
    llave = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_ETIQUETA).derive(
        secreto.encode()
    )
    return Fernet(base64.urlsafe_b64encode(llave))


def cifrar(datos: dict[str, Any]) -> str:
    """Los datos deben ser JSON puro: un tipo no serializable falla aquí, al
    encolar, y no horas después en el worker."""
    return _fernet(settings.SECRET_KEY).encrypt(json.dumps(datos).encode()).decode()


def descifrar(texto: str) -> dict[str, Any]:
    """Lanza `cryptography.fernet.InvalidToken` si el texto no es válido (p. ej. SECRET_KEY rotó)."""
    datos: dict[str, Any] = json.loads(_fernet(settings.SECRET_KEY).decrypt(texto.encode()))
    return datos
