# backend/app/models/recuperacion.py
"""
Sesión efímera de recuperación (CU-030 a CU-035).

Ver la sección de recuperación de db/init/001_init_schema.sql para el
razonamiento completo del modelo zero-knowledge (ECIES X25519 +
AES-256-GCM, servidor solo relé).
"""

import enum
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BINARY,
    CHAR,
    JSON,
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


class EstadoSesionRecuperacion(enum.StrEnum):
    activa = "activa"
    expirada = "expirada"
    abandonada = "abandonada"  # reservado en el ENUM de la BD


class SesionRecuperacion(Base):
    """Intento de recuperación de una bóveda 'en_recuperacion'. Lo funda el
    Beneficiario Principal (BP) con la llave pública de sesión que deriva en
    su navegador (solo se guarda la pública) y caduca a las
    RECUPERACION_SESION_HORAS."""

    __tablename__ = "sesiones_recuperacion"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_boveda: Mapped[int] = mapped_column(ForeignKey("bovedas.id"), index=True)
    x_fundador: Mapped[int] = mapped_column(SMALLINT(unsigned=True))
    bp_public_key: Mapped[str] = mapped_column(CHAR(64))
    bp_kdf_algo: Mapped[str] = mapped_column(String(20), default="pbkdf2-sha256")
    bp_kdf_salt: Mapped[str] = mapped_column(String(64))
    bp_kdf_params: Mapped[dict[str, Any]] = mapped_column(JSON)
    estado: Mapped[EstadoSesionRecuperacion] = mapped_column(
        Enum(EstadoSesionRecuperacion), default=EstadoSesionRecuperacion.activa
    )
    creada_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expira_en: Mapped[datetime] = mapped_column(DateTime)
    # Reporte informativo del navegador del BP tras reconstruir la DEK con
    # éxito (nunca lo verifica el servidor). Se fija una sola vez.
    reconstruido_en: Mapped[datetime | None] = mapped_column(DateTime)


class FragmentoDepositado(Base):
    """Fragmento de un custodio cifrado con ECIES hacia la llave pública del
    BP. El servidor solo lo retransmite: no puede descifrarlo."""

    __tablename__ = "fragmentos_depositados"
    __table_args__ = (UniqueConstraint("id_sesion", "x_fragmento", name="uq_frag_sesion_x"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    id_sesion: Mapped[int] = mapped_column(ForeignKey("sesiones_recuperacion.id"))
    x_fragmento: Mapped[int] = mapped_column(SMALLINT(unsigned=True))
    epk_hex: Mapped[str] = mapped_column(CHAR(64))
    iv: Mapped[bytes] = mapped_column(BINARY(12))
    ciphertext_hex: Mapped[str] = mapped_column(Text)
    nombre_declarado: Mapped[str] = mapped_column(String(150))
    vinculo_declarado: Mapped[str] = mapped_column(String(50))
    # Solo informativo (auditoría): la x coincidió con la de este custodio.
    id_custodio: Mapped[int | None] = mapped_column(ForeignKey("custodios.id"), index=True)
    depositado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
