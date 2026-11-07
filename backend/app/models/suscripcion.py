# backend/app/models/suscripcion.py
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.sesion import Base

if TYPE_CHECKING:
    from app.models.usuario import Propietario


class Suscripcion(Base):
    """Catálogo de planes (Gratuito, Premium, ...). No pertenece a ningún
    propietario en particular; varios propietarios pueden compartir el
    mismo plan a través de PropietarioSuscripcion."""

    __tablename__ = "suscripcion"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(50))
    max_almacenamiento: Mapped[int]  # GB
    max_bovedas: Mapped[int]
    max_custodios: Mapped[int]
    # Único ciclo de facturación: anual. 0 = plan gratuito (sin caducidad).
    costo_anual: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))

    contrataciones: Mapped[list["PropietarioSuscripcion"]] = relationship(
        back_populates="suscripcion"
    )


class PropietarioSuscripcion(Base):
    """Tabla puente: relación N:M entre propietario y suscripcion. Cada fila
    es un periodo [fecha_inicio, fecha_fin) del historial del propietario;
    la vigente es la que cubre el día de hoy (ver `vigente_en`)."""

    __tablename__ = "propietario_suscripcion"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_propietario: Mapped[int] = mapped_column(ForeignKey("propietario.id"), index=True)
    id_suscripcion: Mapped[int] = mapped_column(ForeignKey("suscripcion.id"), index=True)
    fecha_inicio: Mapped[date] = mapped_column(Date)
    # Día en que deja de estar vigente (exclusivo): fecha_inicio + 1 año en un
    # plan de pago, NULL en el gratuito (sin caducidad), o el día de un cambio
    # de plan que la cerró antes.
    fecha_fin: Mapped[date | None] = mapped_column(Date)
    # El propietario canceló: no renovará, pero sigue vigente hasta fecha_fin.
    cancelada_en: Mapped[datetime | None] = mapped_column(DateTime)
    # Orden de PayPal que pagó esta contratación (UNIQUE: una orden, un uso).
    paypal_order_id: Mapped[str | None] = mapped_column(String(64), unique=True)

    propietario: Mapped["Propietario"] = relationship(back_populates="suscripciones")
    suscripcion: Mapped[Suscripcion] = relationship(back_populates="contrataciones")

    def vigente_en(self, dia: date) -> bool:
        return self.fecha_inicio <= dia and (self.fecha_fin is None or dia < self.fecha_fin)
