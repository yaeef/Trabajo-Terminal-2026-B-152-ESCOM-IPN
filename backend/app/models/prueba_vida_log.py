# backend/app/models/prueba_vida_log.py
import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base


class MetodoPruebaVida(enum.StrEnum):
    web_interface = "web_interface"
    telegram_bot = "telegram_bot"  # reservado en el ENUM de la BD
    email_auth = "email_auth"  # reservado en el ENUM de la BD


class PruebaVidaLog(Base):
    """
    Bitácora de pruebas de vida (check-ins) del propietario: cada login
    exitoso deja una fila (services/dms/protocolo.registrar_prueba_de_vida).
    Al purgar la cuenta se anonimiza, no se borra.
    """

    __tablename__ = "prueba_vida_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_propietario: Mapped[int] = mapped_column(ForeignKey("propietario.id"), index=True)
    fecha_prueba: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    metodo: Mapped[MetodoPruebaVida] = mapped_column(Enum(MetodoPruebaVida))
    identificador: Mapped[str | None] = mapped_column(String(150))
    ip_origen: Mapped[str | None] = mapped_column(String(45))
    dias_extendidos: Mapped[int]
