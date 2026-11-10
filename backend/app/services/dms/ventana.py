"""Máquina 2 (M4): la ventana W de recuperación de cada bóveda liberada (RN-002)."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tiempo import ahora, utc
from app.models.boveda import Boveda, EstadoBoveda
from app.services import boveda_service


def procesar_ventana_recuperacion(db: Session) -> int:
    """Las bóvedas 'en_recuperacion' cuya ventana W ya venció se eliminan de
    forma definitiva, con sus archivos en Azure y todos sus registros (ver
    `boveda_service.purgar_boveda`), se haya reconstruido o no la DEK: los
    herederos tuvieron W días para descargar. Devuelve cuántas se eliminaron."""
    momento = ahora()
    ventana = timedelta(days=settings.DMS_RECOVERY_WINDOW_DIAS)
    vencidas = [
        boveda
        for boveda in db.scalars(
            select(Boveda).where(Boveda.estado == EstadoBoveda.en_recuperacion)
        )
        if (inicio := utc(boveda.recuperacion_iniciada_en)) is not None
        and momento >= inicio + ventana
    ]
    for boveda in vencidas:
        boveda_service.purgar_boveda(db, boveda)
        db.commit()  # una por una: los blobs ya borrados no vuelven con un rollback
    return len(vencidas)
