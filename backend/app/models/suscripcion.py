# backend/app/models/suscripcion.py
import enum
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String
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
    # Año de reserva: importe único que deja guardado un año extra del plan
    # para cuando el propietario no renueve. 0 = el plan no lo ofrece.
    costo_reserva: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))

    contrataciones: Mapped[list["PropietarioSuscripcion"]] = relationship(
        back_populates="suscripcion"
    )


class OrigenCobertura(enum.StrEnum):
    """Por qué existe un periodo de `propietario_suscripcion`."""

    contratado = "contratado"  # pagado (PayPal o simulado), asignado por un admin, o el Gratuito
    gracia = "gracia"  # días tras el vencimiento en que aún se puede renovar sin gastar la reserva
    reserva = "reserva"  # el año de reserva cubriendo porque no hubo renovación


class PropietarioSuscripcion(Base):
    """Tabla puente: relación N:M entre propietario y suscripcion. Cada fila
    es un periodo [fecha_inicio, fecha_fin) del historial del propietario;
    la vigente es la que cubre el día de hoy (ver `vigente_en`). Los periodos
    futuros ya agendados (gracia, reserva, Gratuito) también son filas."""

    __tablename__ = "propietario_suscripcion"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_propietario: Mapped[int] = mapped_column(ForeignKey("propietario.id"), index=True)
    id_suscripcion: Mapped[int] = mapped_column(ForeignKey("suscripcion.id"), index=True)
    fecha_inicio: Mapped[date] = mapped_column(Date)
    # Día en que deja de estar vigente (exclusivo): fecha_inicio + 1 año en un
    # plan de pago, NULL en el gratuito (sin caducidad), o el día de un cambio
    # de plan que la cerró antes.
    fecha_fin: Mapped[date | None] = mapped_column(Date)
    # El propietario no quiere renovar: solo apaga los avisos de renovación
    # (la renovación ya es manual, no hay cobro que detener).
    cancelada_en: Mapped[datetime | None] = mapped_column(DateTime)
    # Orden de PayPal que pagó esta contratación (UNIQUE: una orden, un uso).
    paypal_order_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    origen: Mapped[OrigenCobertura] = mapped_column(
        Enum(OrigenCobertura), default=OrigenCobertura.contratado
    )

    propietario: Mapped["Propietario"] = relationship(back_populates="suscripciones")
    suscripcion: Mapped[Suscripcion] = relationship(back_populates="contrataciones")

    def vigente_en(self, dia: date) -> bool:
        return self.fecha_inicio <= dia and (self.fecha_fin is None or dia < self.fecha_fin)

    @property
    def es_de_pago(self) -> bool:
        return self.suscripcion.costo_anual > 0


class EstadoReserva(enum.StrEnum):
    disponible = "disponible"  # guardada; se usa si un año no renueva
    activa = "activa"  # cubriendo: el propietario no renovó tras la gracia
    consumida = "consumida"  # terminó su cobertura, o pagó durante ella


class ReservaContinuidad(Base):
    """Año de reserva (seguro de continuidad) de un propietario. Como mucho
    uno sin consumir por propietario; una vez consumido puede comprar otro."""

    __tablename__ = "reserva_continuidad"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_propietario: Mapped[int] = mapped_column(ForeignKey("propietario.id"), index=True)
    estado: Mapped[EstadoReserva] = mapped_column(
        Enum(EstadoReserva), default=EstadoReserva.disponible
    )
    comprada_en: Mapped[datetime] = mapped_column(DateTime)
    paypal_order_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    activada_en: Mapped[date | None] = mapped_column(Date)
    consumida_en: Mapped[date | None] = mapped_column(Date)
