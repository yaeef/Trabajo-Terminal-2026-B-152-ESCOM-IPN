"""Rondas de votación de los custodios: emisión de enlaces y conteo."""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import seguridad
from app.core.config import settings
from app.core.tiempo import ahora, utc
from app.models.custodio import Custodio
from app.models.dms_atestacion import DmsAtestacion, SentidoAtestacion
from app.models.usuario import Propietario, Usuario
from app.services import tokens
from app.services.dms import avisos


@dataclass(frozen=True)
class Conteo:
    vida: int = 0
    fallecimiento: int = 0


def emitir_ronda(db: Session, prop: Propietario, usuario: Usuario) -> None:
    """
    Una fila `dms_atestacion` por custodio del roster para la ronda vigente,
    con su enlace de voto por correo y/o Telegram. Idempotente por
    (propietario, custodio, ronda).
    """
    ids = prop.dms_roster_ronda or []
    if not ids:
        return
    ya_emitidos = set(
        db.scalars(
            select(DmsAtestacion.id_custodio).where(
                DmsAtestacion.id_propietario == prop.id, DmsAtestacion.ronda == prop.dms_ronda
            )
        )
    )
    custodios = {c.id: c for c in db.scalars(select(Custodio).where(Custodio.id.in_(ids)))}
    for id_custodio in ids:
        if id_custodio in ya_emitidos:
            continue
        token = tokens.token_aleatorio()
        db.add(
            DmsAtestacion(
                id_propietario=prop.id,
                id_custodio=id_custodio,
                ronda=prop.dms_ronda,
                hash_token=seguridad.hash_token(token),
                emitido_en=ahora(),
            )
        )
        custodio = custodios.get(id_custodio)
        if custodio is not None and avisos.custodio_contactable(custodio):
            avisos.voto(db, custodio, usuario, token)


def conteo(db: Session, prop: Propietario) -> Conteo:
    """Votos frescos (≤ TTL) de la ronda vigente."""
    limite = ahora() - timedelta(days=settings.DMS_VOTO_TTL_DIAS)
    filas = db.scalars(
        select(DmsAtestacion).where(
            DmsAtestacion.id_propietario == prop.id,
            DmsAtestacion.ronda == prop.dms_ronda,
            DmsAtestacion.sentido.is_not(None),
        )
    )
    # Se filtra en Python y no en SQL para comparar siempre fechas UTC "aware".
    frescos = [f for f in filas if (votado := utc(f.votado_en)) is not None and votado >= limite]
    return Conteo(
        vida=sum(f.sentido is SentidoAtestacion.vida for f in frescos),
        fallecimiento=sum(f.sentido is SentidoAtestacion.fallecimiento for f in frescos),
    )
