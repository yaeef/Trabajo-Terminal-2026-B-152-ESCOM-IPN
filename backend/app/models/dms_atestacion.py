# backend/app/models/dms_atestacion.py
import enum
from datetime import datetime

from sqlalchemy import CHAR, DateTime, Enum, ForeignKey, Index, SmallInteger, UniqueConstraint
from sqlalchemy.dialects.mysql import SMALLINT
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base


class SentidoAtestacion(enum.StrEnum):
    vida = "vida"
    fallecimiento = "fallecimiento"


class DmsAtestacion(Base):
    """
    Voto de un custodio en el Interruptor de Hombre Muerto (Máquina 1).

    Al entrar a 'gracia' (y en cada reinicio de 'gracia_reduccion') se emite
    una fila por cada custodio del roster congelado en 'alerta', con un token
    de un solo uso hasheado. El custodio abre el enlace y vota 'vida' o
    'fallecimiento'.

    El voto solo se registra si el custodio aporta un fragmento Feldman VSS
    válido (verificado en su propio navegador, igual que en la recuperación
    real) cuya coordenada x coincida con la que tiene asignada en
    `custodios_bovedas` para esa bóveda — así solo el custodio correcto, con
    su fragmento correcto, puede votar. `id_boveda`/`x_fragmento` quedan como
    auditoría de qué fragmento validó el voto (no participan en el cálculo
    de quórum).

    El quórum global k = ⌊Nc/2⌋+1 cuenta las filas de la ronda vigente
    (`ronda == propietario.dms_ronda`) con `sentido` no nulo y `votado_en`
    dentro de los últimos DMS_VOTO_TTL_DIAS días.
    """

    __tablename__ = "dms_atestacion"
    __table_args__ = (
        UniqueConstraint("id_propietario", "id_custodio", "ronda", name="uq_atest_prop_cust_ronda"),
        Index("idx_atest_token", "hash_token"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    id_propietario: Mapped[int] = mapped_column(ForeignKey("propietario.id"))
    id_custodio: Mapped[int] = mapped_column(ForeignKey("custodios.id"), index=True)
    # Bóveda/coordenada del fragmento que validó el voto (auditoría; NULL
    # mientras no hay voto). ondelete="SET NULL": es solo auditoría, no debe
    # impedir borrar la bóveda.
    id_boveda: Mapped[int | None] = mapped_column(
        ForeignKey("bovedas.id", ondelete="SET NULL"), index=True
    )
    x_fragmento: Mapped[int | None] = mapped_column(SMALLINT(unsigned=True))
    ronda: Mapped[int] = mapped_column(SmallInteger)
    # NULL = aún sin votar.
    sentido: Mapped[SentidoAtestacion | None] = mapped_column(Enum(SentidoAtestacion))
    hash_token: Mapped[str] = mapped_column(CHAR(64))
    emitido_en: Mapped[datetime] = mapped_column(DateTime)
    votado_en: Mapped[datetime | None] = mapped_column(DateTime)
