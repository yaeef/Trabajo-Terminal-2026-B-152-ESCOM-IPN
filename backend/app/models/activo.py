# backend/app/models/activo.py
import enum
from datetime import datetime

from sqlalchemy import BINARY, CHAR, TIMESTAMP, Enum, ForeignKey, String, func
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base


class EstadoActivo(enum.StrEnum):
    pendiente = "pendiente"  # SAS emitido, el blob aún no confirmado
    activo = "activo"  # blob subido y confirmado


class ActivoDigital(Base):
    """
    Metadatos de un archivo cifrado de una bóveda.

    El contenido se cifra en el navegador (AES-256-GCM con la DEK de la
    bóveda) y se sube directo a Azure Blob Storage con un SAS de vida corta.
    El servidor solo persiste esto — jamás texto plano ni la DEK.
    """

    __tablename__ = "activos_digitales"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_boveda: Mapped[int] = mapped_column(ForeignKey("bovedas.id"), index=True)
    nombre_original: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str | None] = mapped_column(String(120))
    # id de plantilla de credenciales (cripto_wallet, cuenta_digital, ...).
    # NULL = archivo subido por el usuario. Es una etiqueta, no dato sensible:
    # permite pintar el listado sin pedir la pass-phrase.
    plantilla: Mapped[str | None] = mapped_column(String(40))
    tamano_bytes: Mapped[int] = mapped_column(BIGINT(unsigned=True))  # archivo en claro
    # Tamaño del ciphertext: es el que cuenta para la cuota de almacenamiento.
    tamano_cifrado: Mapped[int] = mapped_column(BIGINT(unsigned=True))
    blob_name: Mapped[str] = mapped_column(String(200), unique=True)
    iv: Mapped[bytes] = mapped_column(BINARY(12))  # nonce AES-GCM
    sha256_plano: Mapped[str | None] = mapped_column(CHAR(64))
    estado: Mapped[EstadoActivo] = mapped_column(Enum(EstadoActivo), default=EstadoActivo.pendiente)
    created_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, server_default=func.now())
