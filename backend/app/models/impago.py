# backend/app/models/impago.py
"""Ciclo de impago (qué pasa con lo que excede el plan Gratuito cuando
termina la cobertura de pago) y registro de avisos ya enviados.
Lógica en services/impago.py."""

import enum
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base


class EstadoCicloImpago(enum.StrEnum):
    abierto = "abierto"  # corre el plazo; al llegar `recorte_en` se recorta
    pausado = "pausado"  # el DMS no está activo: no se borra nada
    cerrado = "cerrado"


class MotivoCierreImpago(enum.StrEnum):
    pago = "pago"  # volvió a pagar
    recorte = "recorte"  # se borró lo que excedía el Gratuito
    sin_exceso = "sin_exceso"  # su uso cabe en el Gratuito: nada que recortar
    liberado = "liberado"  # el DMS se disparó: la herencia no se toca
    cuenta = "cuenta"  # la cuenta se eliminó


class CicloImpago(Base):
    __tablename__ = "ciclo_impago"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_propietario: Mapped[int] = mapped_column(ForeignKey("propietario.id"), index=True)
    inicio: Mapped[date] = mapped_column(Date)  # día en que terminó la cobertura de pago
    recorte_en: Mapped[date] = mapped_column(Date)
    estado: Mapped[EstadoCicloImpago] = mapped_column(
        Enum(EstadoCicloImpago), default=EstadoCicloImpago.abierto
    )
    id_boveda_conservar: Mapped[int | None] = mapped_column(
        ForeignKey("bovedas.id", ondelete="SET NULL")
    )
    cerrado_en: Mapped[datetime | None] = mapped_column(DateTime)
    motivo_cierre: Mapped[MotivoCierreImpago | None] = mapped_column(Enum(MotivoCierreImpago))


class AvisoEnviado(Base):
    """Un aviso de suscripción ya enviado (`clave`, p. ej.
    'renovacion:<id contratación>:7'), para no repetirlo en cada barrido."""

    __tablename__ = "aviso_enviado"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_propietario: Mapped[int] = mapped_column(ForeignKey("propietario.id"), index=True)
    clave: Mapped[str] = mapped_column(String(100))
    enviado_en: Mapped[datetime] = mapped_column(DateTime)
