# backend/app/models/notificacion.py
import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Index, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base


class CanalNotificacion(enum.StrEnum):
    correo = "correo"
    telegram = "telegram"


class EstadoNotificacion(enum.StrEnum):
    pendiente = "pendiente"
    enviada = "enviada"
    fallida = "fallida"  # agotó sus reintentos o nunca podrá enviarse


class Notificacion(Base):
    """
    Outbox transaccional (ver services/notificaciones): cada aviso se inserta
    en la MISMA transacción que el cambio que lo provoca y lo entrega después
    un worker con reintentos. `datos_cifrados` guarda los parámetros de la
    plantilla cifrados (llevan enlaces con tokens y datos personales) y se
    borra en cuanto el aviso se envía o se da por perdido.
    """

    __tablename__ = "notificacion"
    __table_args__ = (Index("idx_notif_pendientes", "estado", "siguiente_intento_en"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    canal: Mapped[CanalNotificacion] = mapped_column(Enum(CanalNotificacion))
    destino: Mapped[str] = mapped_column(String(150))
    plantilla: Mapped[str] = mapped_column(String(60))
    datos_cifrados: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[EstadoNotificacion] = mapped_column(
        Enum(EstadoNotificacion), default=EstadoNotificacion.pendiente
    )
    intentos: Mapped[int] = mapped_column(SmallInteger, default=0)
    siguiente_intento_en: Mapped[datetime] = mapped_column(DateTime)
    ultimo_error: Mapped[str | None] = mapped_column(String(255))
    creada_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    enviada_en: Mapped[datetime | None] = mapped_column(DateTime)
