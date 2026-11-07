# backend/app/services/tokens.py
"""
Tokens de un solo uso: recuperación de contraseña, confirmación del correo
del registro y del correo secundario, verificación del correo de un custodio
y códigos de vinculación de Telegram. Todos siguen el mismo ciclo:

1. `emitir()` genera el valor aleatorio, guarda SOLO su hash con caducidad y
   descarta los pendientes anteriores del mismo dueño (solo sirve el último).
   Devuelve el valor en claro, que existe únicamente en memoria el tiempo
   justo para enviarlo.
2. `buscar()` lo localiza por hash e informa su estado (vigente, usado,
   expirado o inexistente); cada flujo decide qué mensaje dar en cada caso.
3. El flujo lo cierra marcándolo usado (`fila.usado = True`) o con
   `descartar_pendientes()`.

No hace commit: la transacción la cierra el caso de uso que lo llama.
"""

import enum
import secrets
import string
from datetime import timedelta
from typing import Any, TypeVar

from sqlalchemy import ColumnElement, delete, select
from sqlalchemy.orm import Session

from app.core.seguridad import hash_token
from app.core.tiempo import ahora, utc
from app.models.token_un_solo_uso import TokenUnSoloUso

M = TypeVar("M", bound=TokenUnSoloUso)

_ALFABETO_CODIGO = string.ascii_uppercase + string.digits


class EstadoToken(enum.Enum):
    VIGENTE = "vigente"
    USADO = "usado"
    EXPIRADO = "expirado"
    INEXISTENTE = "inexistente"


def token_aleatorio() -> str:
    """256 bits aleatorios, aptos para ir en un enlace."""
    return secrets.token_urlsafe(32)


def codigo_aleatorio(longitud: int = 8) -> str:
    """Código corto (A-Z0-9) para teclearlo o mandarlo al bot: 36^8 ≈ 2.8e12."""
    return "".join(secrets.choice(_ALFABETO_CODIGO) for _ in range(longitud))


def descartar_pendientes(db: Session, modelo: type[M], del_dueno: ColumnElement[bool]) -> None:
    db.execute(delete(modelo).where(del_dueno, modelo.usado.is_(False)))


def emitir(
    db: Session,
    modelo: type[M],
    del_dueno: ColumnElement[bool],
    *,
    vigencia: timedelta,
    valor: str | None = None,
    **campos: Any,
) -> tuple[M, str]:
    """Crea el token (descartando los pendientes del mismo dueño) y devuelve
    `(fila, valor_en_claro)`."""
    descartar_pendientes(db, modelo, del_dueno)
    en_claro = valor or token_aleatorio()
    # El mixin no declara __init__ (lo aporta cada modelo mapeado): se pasan como **kwargs.
    columnas: dict[str, Any] = {
        "hash_token": hash_token(en_claro),
        "fecha_expiracion": ahora() + vigencia,
        "usado": False,
        **campos,
    }
    fila = modelo(**columnas)
    db.add(fila)
    db.flush()
    return fila, en_claro


def buscar(db: Session, modelo: type[M], en_claro: str) -> tuple[M | None, EstadoToken]:
    fila = db.scalar(select(modelo).where(modelo.hash_token == hash_token(en_claro)))
    if fila is None:
        return None, EstadoToken.INEXISTENTE
    if fila.usado:
        return fila, EstadoToken.USADO
    if utc(fila.fecha_expiracion) <= ahora():
        return fila, EstadoToken.EXPIRADO
    return fila, EstadoToken.VIGENTE


def vigente(db: Session, modelo: type[M], en_claro: str) -> M | None:
    """Atajo: la fila solo si el token está vigente."""
    fila, estado = buscar(db, modelo, en_claro)
    return fila if estado is EstadoToken.VIGENTE else None
