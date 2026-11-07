"""
Ejecución de la máquina de estados del DMS.

- `disparar()` aplica un evento: consulta la tabla (`estados.siguiente`),
  cambia el estado y ejecuta la acción de entrada del estado destino.
- `evaluar()` decide qué evento ocurrió para un propietario según tiempos y
  votos (o manda el recordatorio que toque) y lo dispara.
- `procesar_dms()` es el barrido periódico: una transacción por propietario.

Nada aquí confirma la transacción salvo el barrido: el resto corre dentro
de la unidad de trabajo de quien llama.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tiempo import ahora, dias_entre, utc
from app.models.boveda import EstadoBoveda
from app.models.usuario import EstadoDMS, Propietario, Usuario
from app.services.dms import avisos, estados, roster, votos
from app.services.dms.estados import Evento

logger = logging.getLogger("b152.dms")

# Cadencia de recordatorios (días) por estado.
_CADENCIA_DIAS = {EstadoDMS.alerta: 3, EstadoDMS.gracia: 1, EstadoDMS.gracia_reduccion: 5}


@dataclass(frozen=True)
class _Contexto:
    db: Session
    prop: Propietario
    usuario: Usuario
    origen: EstadoDMS
    momento: datetime

    @property
    def umbral_dias(self) -> int:
        return self.prop.periodicidad_prueba or 60

    @property
    def gracia_dias(self) -> int:
        return self.prop.periodicidad_periodo_gracia or 7


def _dias_para_gracia(ctx: _Contexto) -> int:
    inactivo = dias_entre(ctx.momento, utc(ctx.prop.ultima_prueba)) if ctx.prop.ultima_prueba else 0
    return max(1, round(ctx.umbral_dias - inactivo))


def _paso_cooldown_reconfirmacion(prop: Propietario, momento: datetime) -> bool:
    """Evita que varias rondas de 'vida' seguidas en 'gracia_reduccion' agoten
    DMS_MAX_RECONFIRMACIONES en minutos: una nueva ronda solo cuenta (como
    reconfirmación o, agotado el tope, como liberación) si ya pasó el
    cooldown desde el último aviso (inicio de la ronda vigente o su último
    recordatorio)."""
    ultimo = utc(prop.dms_ultimo_aviso)
    if ultimo is None:
        return True
    cooldown = timedelta(hours=settings.DMS_COOLDOWN_RECONFIRMACION_HORAS)
    return momento - ultimo >= cooldown


# --- Acciones de entrada -------------------------------------------------------
def _entrar_alerta(ctx: _Contexto) -> None:
    """Se congela el roster y su quórum para todo el episodio."""
    prop = ctx.prop
    ids = roster.ids_roster(ctx.db, prop.id)
    prop.dms_roster_ronda = ids
    prop.dms_quorum = roster.quorum(len(ids))
    prop.dms_alerta_en = ctx.momento
    prop.dms_gracia_en = None
    prop.dms_reduccion_hasta = None
    prop.dms_reconfirmaciones = 0
    prop.dms_ultimo_aviso = ctx.momento
    avisos.alerta(ctx.db, prop, ctx.usuario, _dias_para_gracia(ctx))


def _entrar_gracia(ctx: _Contexto) -> None:
    prop = ctx.prop
    prop.dms_gracia_en = ctx.momento
    prop.dms_ronda = (prop.dms_ronda or 0) + 1
    prop.dms_ultimo_aviso = ctx.momento
    votos.emitir_ronda(ctx.db, prop, ctx.usuario)
    avisos.gracia(ctx.db, ctx.usuario, ctx.momento + timedelta(days=ctx.gracia_dias))


def _entrar_gracia_reduccion(ctx: _Contexto) -> None:
    """Desde 'gracia' abre el plazo R; desde sí misma es una reconfirmación
    (los custodios volvieron a votar 'vida'): cuenta una más y lo reinicia."""
    prop = ctx.prop
    if ctx.origen is EstadoDMS.gracia_reduccion:
        prop.dms_reconfirmaciones = (prop.dms_reconfirmaciones or 0) + 1
    else:
        prop.dms_reconfirmaciones = 0
    limite = ctx.momento + timedelta(days=settings.DMS_REDUCCION_DIAS)
    prop.dms_reduccion_hasta = limite
    prop.dms_ronda = (prop.dms_ronda or 0) + 1
    prop.dms_ultimo_aviso = ctx.momento
    votos.emitir_ronda(ctx.db, prop, ctx.usuario)
    avisos.gracia_reduccion(ctx.db, ctx.usuario, limite)


def _entrar_liberado(ctx: _Contexto) -> None:
    """Cada bóveda recuperable pasa a 'en_recuperacion' (ventana W, RN-002)."""
    ctx.prop.dms_liberado_en = ctx.momento
    for boveda in roster.bovedas_recuperables(ctx.db, ctx.prop.id):
        boveda.estado = EstadoBoveda.en_recuperacion
        boveda.recuperacion_iniciada_en = ctx.momento
    ctx.db.flush()
    avisos.liberado(ctx.db, ctx.prop, ctx.usuario)


def _entrar_activo(ctx: _Contexto) -> None:
    prop = ctx.prop
    prop.dms_alerta_en = None
    prop.dms_gracia_en = None
    prop.dms_reduccion_hasta = None
    prop.dms_liberado_en = None
    prop.dms_reconfirmaciones = 0
    prop.dms_roster_ronda = None
    prop.dms_quorum = None
    prop.dms_ultimo_aviso = None
    if ctx.origen in estados.EN_CURSO:
        avisos.reactivado(ctx.db, ctx.usuario)


def _sin_accion(ctx: _Contexto) -> None:
    """Pausa y baja de la cuenta: sus efectos los aplica el servicio de cuentas."""


_AL_ENTRAR: dict[EstadoDMS, Callable[[_Contexto], None]] = {
    EstadoDMS.activo: _entrar_activo,
    EstadoDMS.alerta: _entrar_alerta,
    EstadoDMS.gracia: _entrar_gracia,
    EstadoDMS.gracia_reduccion: _entrar_gracia_reduccion,
    EstadoDMS.liberado: _entrar_liberado,
    EstadoDMS.pausado_eliminacion: _sin_accion,
    EstadoDMS.eliminado: _sin_accion,
}


def disparar(
    db: Session, prop: Propietario, evento: Evento, momento: datetime | None = None
) -> EstadoDMS:
    """Aplica `evento` al interruptor de `prop` y devuelve el estado destino.
    Lanza `estados.TransicionInvalida` si el evento no aplica al estado actual."""
    origen = EstadoDMS(prop.status_dms)
    destino = estados.siguiente(origen, evento)
    prop.status_dms = destino
    _AL_ENTRAR[destino](_Contexto(db, prop, prop.usuario, origen, momento or ahora()))
    db.flush()
    logger.info("DMS del propietario %s: %s --%s--> %s", prop.id, origen, evento, destino)
    return destino


# --- Evaluación por tiempo y votos -------------------------------------------
def _evento_pendiente(
    db: Session, prop: Propietario, usuario: Usuario, momento: datetime
) -> Evento | None:
    """Qué evento ocurrió (si alguno) según el tiempo transcurrido y los votos."""
    umbral = prop.periodicidad_prueba or 60
    gracia = prop.periodicidad_periodo_gracia or 7
    inactivo = dias_entre(momento, utc(prop.ultima_prueba)) if prop.ultima_prueba else 0.0
    parcial = settings.DMS_ALERTA_PORCENTAJE * umbral

    match prop.status_dms:
        case EstadoDMS.activo:
            if inactivo >= parcial and roster.armado(db, prop, usuario):
                return Evento.inactividad
        case EstadoDMS.alerta:
            if inactivo < parcial:
                return Evento.senal_de_vida  # red de seguridad: hubo actividad reciente
            if inactivo >= umbral:
                return Evento.inactividad_total
        case EstadoDMS.gracia:
            conteo = votos.conteo(db, prop)
            k = prop.dms_quorum or 1
            if conteo.fallecimiento >= k:
                return Evento.quorum_fallecimiento
            if prop.dms_gracia_en and dias_entre(momento, utc(prop.dms_gracia_en)) >= gracia:
                return Evento.plazo_vencido
            if conteo.vida >= k:
                return Evento.quorum_vida
        case EstadoDMS.gracia_reduccion:
            conteo = votos.conteo(db, prop)
            k = prop.dms_quorum or 1
            if conteo.fallecimiento >= k:
                return Evento.quorum_fallecimiento
            if prop.dms_reduccion_hasta and momento >= utc(prop.dms_reduccion_hasta):
                return Evento.plazo_vencido
            if conteo.vida >= k and _paso_cooldown_reconfirmacion(prop, momento):
                if (prop.dms_reconfirmaciones or 0) < settings.DMS_MAX_RECONFIRMACIONES:
                    return Evento.quorum_vida
                return Evento.reconfirmaciones_agotadas
    return None


def _toca_recordatorio(prop: Propietario, momento: datetime) -> bool:
    cadencia = _CADENCIA_DIAS.get(prop.status_dms)
    if cadencia is None:
        return False
    ultimo = utc(prop.dms_ultimo_aviso)
    return ultimo is None or dias_entre(momento, ultimo) >= cadencia


def _recordar(db: Session, prop: Propietario, usuario: Usuario, momento: datetime) -> None:
    prop.dms_ultimo_aviso = momento
    ctx = _Contexto(db, prop, usuario, EstadoDMS(prop.status_dms), momento)
    match prop.status_dms:
        case EstadoDMS.alerta:
            avisos.alerta(db, prop, usuario, _dias_para_gracia(ctx))
        case EstadoDMS.gracia if prop.dms_gracia_en:
            avisos.recordatorio_gracia(
                db, usuario, utc(prop.dms_gracia_en) + timedelta(days=ctx.gracia_dias)
            )
        case EstadoDMS.gracia_reduccion if prop.dms_reduccion_hasta:
            avisos.recordatorio_reduccion(db, usuario, utc(prop.dms_reduccion_hasta))


def evaluar(db: Session, prop: Propietario, momento: datetime) -> str | None:
    """
    Aplica a lo sumo una transición y devuelve su nombre ('alerta', 'gracia',
    'gracia_reduccion', 'liberado' o 'reactivado'), o None si no hubo; en
    ese caso manda el recordatorio del estado si ya le toca.
    """
    usuario = prop.usuario
    if usuario is None or prop.ultima_prueba is None or prop.status_dms not in estados.EVALUABLES:
        return None
    evento = _evento_pendiente(db, prop, usuario, momento)
    if evento is None:
        if _toca_recordatorio(prop, momento):
            _recordar(db, prop, usuario, momento)
        return None
    destino = disparar(db, prop, evento, momento)
    return "reactivado" if destino is EstadoDMS.activo else destino.value


def recordar_ahora(db: Session, prop: Propietario, momento: datetime | None = None) -> None:
    """Reenvía ya mismo el aviso/recordatorio del estado vigente, sin esperar
    la cadencia normal (`_CADENCIA_DIAS`). Uso admin: un custodio dice no
    haber recibido el correo/Telegram."""
    usuario = prop.usuario
    if usuario is not None:
        _recordar(db, prop, usuario, momento or ahora())


def extender_plazo(db: Session, prop: Propietario, dias: int) -> None:
    """Extiende `dias` el plazo vigente de 'gracia' o 'gracia_reduccion' (uso
    admin, p. ej. un custodio con impedimento justificado). Asume que el
    llamador ya validó que el estado admite esta acción; no dispara avisos
    ni hace commit."""
    if prop.status_dms is EstadoDMS.gracia and prop.dms_gracia_en:
        prop.dms_gracia_en = utc(prop.dms_gracia_en) + timedelta(days=dias)
    elif prop.status_dms is EstadoDMS.gracia_reduccion and prop.dms_reduccion_hasta:
        prop.dms_reduccion_hasta = utc(prop.dms_reduccion_hasta) + timedelta(days=dias)
    else:
        raise ValueError(
            "Solo aplica con una votación de DMS abierta ('gracia' o 'gracia_reduccion')."
        )
    db.flush()


def procesar_dms(db: Session) -> dict[str, int]:
    """Barrido periódico: evalúa el interruptor de cada propietario en un
    estado evaluable, confirmando por separado a cada uno (un fallo no
    detiene a los demás). Devuelve el conteo de transiciones aplicadas."""
    momento = ahora()
    resumen = dict.fromkeys(("alerta", "gracia", "gracia_reduccion", "liberado", "reactivado"), 0)
    ids = db.scalars(
        select(Propietario.id).where(
            Propietario.status_dms.in_(estados.EVALUABLES), Propietario.ultima_prueba.is_not(None)
        )
    ).all()
    for id_propietario in ids:
        try:
            prop = db.get(Propietario, id_propietario)
            cambio = evaluar(db, prop, momento) if prop is not None else None
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Fallo procesando el DMS del propietario %s", id_propietario)
            continue
        if cambio:
            resumen[cambio] += 1
    return resumen
