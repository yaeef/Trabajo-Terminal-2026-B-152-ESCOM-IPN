# backend/app/models/custodio.py
import enum
from datetime import datetime

from sqlalchemy import TIMESTAMP, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base
from app.models.token_un_solo_uso import TokenUnSoloUso


class CanalVerificacion(enum.StrEnum):
    # Telegram no usa estos tokens: se vincula por chat_id con el /start del bot.
    correo = "correo"


class Custodio(Base):
    """
    CU-010 a CU-014. Contacto de confianza del propietario.

    NO es una cuenta de usuario: sin login, sin contraseña, sin fila en
    `usuario`. Sin FK a bóveda — es un directorio independiente por
    propietario (modelo N:M); la vinculación custodio<->bóveda vive en
    `custodios_bovedas` (models/boveda.CustodioBoveda).
    """

    __tablename__ = "custodios"
    __table_args__ = (
        # Un canal de contacto no se repite en el directorio del propietario.
        UniqueConstraint("id_propietario", "correo", name="uq_cust_prop_correo"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    id_propietario: Mapped[int] = mapped_column(ForeignKey("propietario.id"))
    nombre: Mapped[str] = mapped_column(String(100))
    paterno: Mapped[str | None] = mapped_column(String(100))
    materno: Mapped[str | None] = mapped_column(String(100))
    parentesco: Mapped[str] = mapped_column(String(50), default="Familiar")
    correo: Mapped[str] = mapped_column(String(100))
    correo_verificado: Mapped[bool] = mapped_column(default=False)
    # chat_id real, capturado cuando el custodio manda al bot su código de
    # vinculación (ver telegram_service.procesar_start).
    telegram_chat_id: Mapped[str | None] = mapped_column(String(50))
    telegram_verificado: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, server_default=func.now())


class VerificacionCustodio(TokenUnSoloUso, Base):
    """
    Token de un solo uso para confirmar el correo del custodio (ver
    services/tokens.py): en BD solo se guarda el hash.
    """

    __tablename__ = "verificacion_custodio"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_custodio: Mapped[int] = mapped_column(ForeignKey("custodios.id"), index=True)
    canal: Mapped[CanalVerificacion] = mapped_column(
        Enum(CanalVerificacion), default=CanalVerificacion.correo
    )
    destino: Mapped[str] = mapped_column(String(150))
