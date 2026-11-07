from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(bind=engine, autoflush=True, expire_on_commit=True)


class Base(DeclarativeBase):
    """Base declarativa (SQLAlchemy 2.0, modelos tipados con Mapped[])."""


def obtener_sesion() -> Iterator[Session]:
    """
    Unidad de trabajo por petición: los servicios solo modifican la sesión
    (a lo sumo `flush()`), y aquí se confirma TODO junto si el endpoint
    terminó bien o se revierte TODO si lanzó (incluida una HTTPException).
    Así un caso de uso nunca queda a medias, y los avisos encolados
    (services/notificaciones) salen solo si su cambio se confirmó.

    Debe declararse con `Depends(obtener_sesion, scope="function")` (ver
    `api/dependencias.SesionBD`): el commit ocurre antes de enviar la respuesta, de
    modo que un fallo al confirmar se reporta como error y no como éxito.
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
