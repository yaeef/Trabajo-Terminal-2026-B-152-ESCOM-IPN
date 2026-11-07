"""
Tiempo del backend: siempre UTC y siempre "aware".

Las columnas DATETIME de MariaDB no guardan zona horaria: PyMySQL escribe la
hora de pared de un datetime (se guarda UTC porque todo lo que se escribe
viene de `ahora()`), y al leer devuelve datetimes "naive". Regla única:

- el código produce fechas con `ahora()` (aware, UTC);
- todo valor leído de la BD pasa por `utc()` antes de compararse.

Así ya no conviven `datetime.utcnow()` (naive, obsoleto desde Python 3.12)
con `datetime.now(timezone.utc)`, ni hay helpers repetidos por servicio.
"""

from datetime import UTC, date, datetime
from typing import overload


def ahora() -> datetime:
    """Momento actual, aware en UTC."""
    return datetime.now(UTC)


def hoy() -> date:
    """Día UTC en curso (vigencia de suscripciones, columnas DATE)."""
    return ahora().date()


@overload
def utc(momento: datetime) -> datetime: ...
@overload
def utc(momento: None) -> None: ...
@overload
def utc(momento: datetime | None) -> datetime | None: ...
def utc(momento: datetime | None) -> datetime | None:
    """Normaliza un datetime leído de la BD (naive = UTC) a aware UTC."""
    if momento is None:
        return None
    return momento if momento.tzinfo is not None else momento.replace(tzinfo=UTC)


def dias_entre(a: datetime, b: datetime) -> float:
    """Días (con fracción) transcurridos de `b` a `a`; negativo si `b` es posterior."""
    return (utc(a) - utc(b)).total_seconds() / 86400.0
