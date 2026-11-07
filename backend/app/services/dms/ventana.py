"""Máquina 2 (M4): la ventana W de recuperación de cada bóveda liberada (RN-002)."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tiempo import ahora, utc
from app.models.boveda import Boveda, EstadoBoveda


def procesar_ventana_recuperacion(db: Session) -> int:
    """Las bóvedas 'en_recuperacion' cuya ventana W ya venció pasan a
    'expirada' (el portal de recuperación deja de encontrarlas), se haya
    reconstruido o no la DEK. Devuelve cuántas expiraron."""
    momento = ahora()
    ventana = timedelta(days=settings.DMS_RECOVERY_WINDOW_DIAS)
    expiradas = 0
    for boveda in db.scalars(select(Boveda).where(Boveda.estado == EstadoBoveda.en_recuperacion)):
        inicio = utc(boveda.recuperacion_iniciada_en)
        if inicio is not None and momento >= inicio + ventana:
            boveda.estado = EstadoBoveda.expirada
            expiradas += 1
    db.commit()
    return expiradas
