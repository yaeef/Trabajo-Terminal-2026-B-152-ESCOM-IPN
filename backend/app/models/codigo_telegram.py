# backend/app/models/codigo_telegram.py

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base
from app.models.token_un_solo_uso import TokenUnSoloUso


class CodigoVinculacionTelegram(TokenUnSoloUso, Base):
    """
    Código de un solo uso para vincular un chat_id de Telegram, ya sea al
    propietario (id_usuario) o a un custodio (id_custodio) — exactamente
    uno de los dos va lleno en cada fila. El webhook decide a cuál de los
    dos aplicar según cuál venga presente.

    El atributo se llama `hash_token` (como en el resto de tokens de un solo
    uso, ver services/tokens.py) aunque la columna sea `hash_codigo`.
    """

    __tablename__ = "telegram_link_code"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_usuario: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"), index=True)
    id_custodio: Mapped[int | None] = mapped_column(ForeignKey("custodios.id"), index=True)
    hash_token: Mapped[str] = mapped_column("hash_codigo", String(255), unique=True)
