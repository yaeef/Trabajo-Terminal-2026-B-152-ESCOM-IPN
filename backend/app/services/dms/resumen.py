"""Qué llevó a liberar el patrimonio: lo ve el propietario si reaparece después."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tiempo import utc
from app.models.custodio import Custodio
from app.models.dms_atestacion import DmsAtestacion, SentidoAtestacion
from app.models.usuario import EstadoDMS, Usuario
from app.schemas.dms import (
    LiberacionResumenResponse,
    LiberacionRondaResumen,
    LiberacionVotoItem,
    MotivoLiberacion,
)


def resumen_liberacion(db: Session, usuario: Usuario) -> LiberacionResumenResponse:
    """
    Motivo y votos de cada ronda del episodio que terminó en la liberación
    (PatrimonioLiberado.tsx). `liberado=False` si el estado actual no es
    'liberado' (nada que mostrar).
    """
    prop = usuario.propietario
    if prop is None or prop.status_dms is not EstadoDMS.liberado:
        return LiberacionResumenResponse(liberado=False)

    k = prop.dms_quorum or 1
    total = len(prop.dms_roster_ronda or [])

    # `dms_gracia_en` marca el inicio del episodio vigente (solo lo limpia la
    # vuelta a 'activo'): descarta rondas de episodios anteriores que se
    # revirtieron a tiempo. Se filtra en Python para comparar fechas "aware".
    inicio = utc(prop.dms_gracia_en) or utc(prop.dms_alerta_en)
    filas = list(db.scalars(select(DmsAtestacion).where(DmsAtestacion.id_propietario == prop.id)))
    if inicio is not None:
        filas = [f for f in filas if (utc(f.emitido_en) or inicio) >= inicio]

    ids = {f.id_custodio for f in filas}
    nombres = (
        {c.id: c.nombre for c in db.scalars(select(Custodio).where(Custodio.id.in_(ids)))}
        if ids
        else {}
    )
    por_ronda: dict[int, list[LiberacionVotoItem]] = {}
    for f in sorted(filas, key=lambda f: (f.ronda, f.id)):
        por_ronda.setdefault(f.ronda, []).append(
            LiberacionVotoItem(
                custodio_nombre=nombres.get(f.id_custodio, "Custodio"),
                sentido=f.sentido.value if f.sentido else None,
                votado_en=f.votado_en,
            )
        )

    finales = [f for f in filas if f.ronda == prop.dms_ronda]
    vida = sum(f.sentido is SentidoAtestacion.vida for f in finales)
    fallecimiento = sum(f.sentido is SentidoAtestacion.fallecimiento for f in finales)
    maximo = settings.DMS_MAX_RECONFIRMACIONES

    motivo: MotivoLiberacion
    if fallecimiento >= k:
        motivo = "fallecimiento_confirmado"
        detalle = (
            f"{fallecimiento} de {total} custodio(s) confirmaron el fallecimiento "
            f"(se necesitaban {k}), por lo que el patrimonio se liberó."
        )
    elif vida >= k and (prop.dms_reconfirmaciones or 0) >= maximo:
        motivo = "limite_reconfirmaciones"
        detalle = (
            f"Tus custodios confirmaron que seguías con vida, pero ya se habían usado las "
            f"{maximo} reconfirmaciones permitidas para posponer la "
            f"liberación, así que el patrimonio se liberó de todas formas."
        )
    else:
        motivo = "tiempo_agotado"
        detalle = (
            "Se agotó el plazo para reunir las confirmaciones necesarias de tus custodios: no "
            "hubo señal de vida tuya (inicio de sesión) ni suficientes votos a tiempo."
        )

    return LiberacionResumenResponse(
        liberado=True,
        liberado_en=prop.dms_liberado_en,
        motivo=motivo,
        motivo_detalle=detalle,
        alerta_en=prop.dms_alerta_en,
        gracia_en=prop.dms_gracia_en,
        quorum=k,
        total_custodios=total,
        reconfirmaciones=prop.dms_reconfirmaciones or 0,
        max_reconfirmaciones=maximo,
        rondas=[LiberacionRondaResumen(ronda=r, votos=v) for r, v in sorted(por_ronda.items())],
    )
