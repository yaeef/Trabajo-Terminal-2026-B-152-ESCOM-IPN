# backend/app/models/token_un_solo_uso.py
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column


class TokenUnSoloUso:
    """
    Columnas comunes de todo token de un solo uso (ver services/tokens.py):
    solo se guarda el HASH del valor, con caducidad y marca de usado.
    """

    hash_token: Mapped[str] = mapped_column(String(255), unique=True)
    fecha_expiracion: Mapped[datetime] = mapped_column(DateTime)
    usado: Mapped[bool] = mapped_column(default=False)
