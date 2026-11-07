"""
Tipos de entrada reutilizables (Pydantic v2, `Annotated` + validadores).

Cada regla se define una vez aquí y los esquemas la usan como tipo, en
lugar de repetir el mismo `@field_validator` en cada clase.
"""

import re
from typing import Annotated, Any

from pydantic import AfterValidator, BeforeValidator

HEX_RE = re.compile(r"^[0-9a-fA-F]+$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

MAX_X = 65535  # coordenada x de un share (motor WASM)
LONGITUD_HEX_VERIFICADOR = 64  # sha256 en hex
MAX_NOMBRE_PERSONA = 100  # nombre/paterno/materno son VARCHAR(100) en usuario y custodios


def hex_de_longitud(v: str, longitud: int, campo: str) -> str:
    v = (v or "").strip().lower()
    if not HEX_RE.match(v) or len(v) != longitud:
        raise ValueError(
            f"{campo} debe ser hexadecimal de {longitud // 2} bytes ({longitud} caracteres)."
        )
    return v


def _verificador(v: str) -> str:
    v = (v or "").strip().lower()
    if not HEX_RE.match(v) or len(v) != LONGITUD_HEX_VERIFICADOR:
        raise ValueError("passphrase_verifier debe ser un hash sha256 en hex (64 chars).")
    return v


def _coordenada_x(v: int) -> int:
    if not (1 <= v <= MAX_X):
        raise ValueError(f"x_fragmento debe estar entre 1 y {MAX_X}.")
    return v


def _recortar(v: object) -> object:
    return v.strip() if isinstance(v, str) else v


def texto_acotado(v: str, campo: str, minimo: int, maximo: int) -> str:
    if not (minimo <= len(v) <= maximo):
        raise ValueError(f"{campo} debe tener entre {minimo} y {maximo} caracteres.")
    return v


def sin_control(v: str, campo: str) -> str:
    """Rechaza caracteres de control (saltos de línea incluidos) en nombres
    que terminan en asuntos de correo y mensajes a terceros."""
    if CONTROL_RE.search(v):
        raise ValueError(f"{campo} contiene caracteres no permitidos.")
    return v


def _apellido(v: str | None) -> str | None:
    if not v:
        return None
    if len(v) > MAX_NOMBRE_PERSONA:
        raise ValueError(f"El apellido no puede exceder {MAX_NOMBRE_PERSONA} caracteres.")
    return sin_control(v, "El apellido")


def salt_kdf_hex(v: str, campo: str) -> str:
    """Salt de una KDF: hex de 8 a 32 bytes, normalizado a minúsculas."""
    v = (v or "").strip().lower()
    if not HEX_RE.match(v) or not (16 <= len(v) <= 64) or len(v) % 2:
        raise ValueError(f"{campo} debe ser hex de 8 a 32 bytes.")
    return v


def params_kdf_acotados(v: dict[str, Any], campo: str) -> dict[str, Any]:
    """Parámetros de una KDF: un objeto pequeño (1 a 10 claves)."""
    if not (1 <= len(v) <= 10):
        raise ValueError(f"{campo} debe ser un objeto con 1 a 10 claves.")
    return v


# El verificador de la pass-phrase de una bóveda: sha256(verifier) en hex.
Verificador = Annotated[str, AfterValidator(_verificador)]
# Coordenada x de un fragmento Shamir (pública).
CoordenadaX = Annotated[int, AfterValidator(_coordenada_x)]
# Texto al que se le quitan espacios de los extremos antes de validar.
TextoRecortado = Annotated[str, BeforeValidator(_recortar)]
# Apellido opcional de una persona (usuario o custodio); vacío = None.
Apellido = Annotated[TextoRecortado | None, AfterValidator(_apellido)]
