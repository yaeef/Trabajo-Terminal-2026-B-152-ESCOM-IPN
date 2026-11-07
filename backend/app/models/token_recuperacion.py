# backend/app/models/token_recuperacion.py
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import TIMESTAMP, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.sesion import Base
from app.models.token_un_solo_uso import TokenUnSoloUso

if TYPE_CHECKING:
    from app.models.usuario import Usuario


class TokenRecuperacion(TokenUnSoloUso, Base):
    """
    Token de un solo uso para RECUPERACIÓN DE CUENTA (tabla `token`).

    No confundir con el JWT de acceso de /login (schemas.usuario.TokenAccesoResponse):
    el JWT identifica una sesión; este token permite resetear la contraseña
    una vez (ver services/tokens.py).
    """

    __tablename__ = "token"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_usuario: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
    fecha_creacion: Mapped[datetime | None] = mapped_column(TIMESTAMP, server_default=func.now())

    usuario: Mapped["Usuario"] = relationship(back_populates="tokens_recuperacion")
