# backend/app/models/boveda.py
import enum
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CHAR,
    JSON,
    TIMESTAMP,
    DateTime,
    Enum,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.mysql import SMALLINT
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base


class EstadoBoveda(enum.StrEnum):
    borrador = "borrador"  # creada, sin compromisos VSS todavía
    activa = "activa"  # compromisos subidos, operativa
    en_recuperacion = "en_recuperacion"  # el Interruptor de Hombre Muerto se disparó
    expirada = "expirada"  # venció el plazo de recuperación (RN-002)


class Boveda(Base):
    """
    Metadatos y parámetros criptográficos de una bóveda.

    El servidor NO conoce la llave maestra ni los fragmentos (valores `y`).
    `umbral_k` / `total_fragmentos_n` quedan en NULL hasta que el navegador
    sube los compromisos Feldman (PUT /bovedas/{id}/vss).
    """

    __tablename__ = "bovedas"

    id: Mapped[int] = mapped_column(primary_key=True)
    pid: Mapped[str] = mapped_column(CHAR(22), unique=True)
    id_propietario: Mapped[int] = mapped_column(ForeignKey("propietario.id"), index=True)
    nombre: Mapped[str] = mapped_column(String(150))
    categoria: Mapped[str | None] = mapped_column(String(50))
    mensaje_custodios: Mapped[str | None] = mapped_column(Text)
    # Envoltura para derivar la DEK de la pass-phrase de la bóveda (todo no secreto
    # salvo la pass-phrase misma, que nunca llega aquí). passphrase_verificador =
    # sha256(verifier) donde verifier lo calcula el cliente a partir de la DEK.
    kdf_algo: Mapped[str] = mapped_column(String(20), default="argon2id")
    kdf_salt: Mapped[str] = mapped_column(String(64))
    kdf_params: Mapped[dict[str, Any]] = mapped_column(JSON)
    passphrase_verificador: Mapped[str] = mapped_column(CHAR(64))
    umbral_k: Mapped[int | None] = mapped_column(SMALLINT(unsigned=True))
    total_fragmentos_n: Mapped[int | None] = mapped_column(SMALLINT(unsigned=True))
    estado: Mapped[EstadoBoveda] = mapped_column(Enum(EstadoBoveda), default=EstadoBoveda.borrador)
    # Ancla de la ventana de recuperación W (RN-002): se fija al pasar a
    # 'en_recuperacion' cuando el Interruptor de Hombre Muerto se dispara.
    recuperacion_iniciada_en: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, server_default=func.now())


class CompromisoVss(Base):
    """
    Compromisos públicos Feldman VSS de una bóveda (1:1).

    commitments_hex: k puntos comprimidos SEC1 (33 B) concatenados, en hex.
    x_coords: las n coordenadas x del reparto — públicas, sirven para
    validar que la x asignada a un custodio pertenece a este reparto.
    """

    __tablename__ = "vss_commitments"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_boveda: Mapped[int] = mapped_column(ForeignKey("bovedas.id"), unique=True)
    commitments_hex: Mapped[str] = mapped_column(Text)
    x_coords: Mapped[list[int]] = mapped_column(JSON)
    created_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, server_default=func.now())


class CustodioBoveda(Base):
    """
    Puente N:M custodio <-> bóveda + la coordenada `x` del fragmento que
    custodia (no secreta). El valor `y` real nunca llega al servidor.
    """

    __tablename__ = "custodios_bovedas"
    __table_args__ = (
        UniqueConstraint("id_boveda", "id_custodio", name="id_boveda"),
        UniqueConstraint("id_boveda", "x_fragmento", name="id_boveda_2"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    id_custodio: Mapped[int] = mapped_column(ForeignKey("custodios.id"), index=True)
    id_boveda: Mapped[int] = mapped_column(ForeignKey("bovedas.id"))
    x_fragmento: Mapped[int] = mapped_column(SMALLINT(unsigned=True))
    created_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, server_default=func.now())
