# backend/app/models/verificacion_correo.py

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base
from app.models.token_un_solo_uso import TokenUnSoloUso


class VerificacionCorreoSec(TokenUnSoloUso, Base):
    """Token de un solo uso para confirmar el correo secundario (ver services/tokens.py)."""

    __tablename__ = "verificacion_correo_sec"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_usuario: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
    correo_nuevo: Mapped[str] = mapped_column(String(100))


class VerificacionCorreoRegistro(TokenUnSoloUso, Base):
    """Token de un solo uso para confirmar el correo principal de una cuenta
    recién registrada; hasta usarlo no se puede iniciar sesión (ver
    services/tokens.py)."""

    __tablename__ = "verificacion_correo_registro"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_usuario: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
