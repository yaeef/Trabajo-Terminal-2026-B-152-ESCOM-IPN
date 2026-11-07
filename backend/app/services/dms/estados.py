"""
Máquina de estados del Interruptor de Hombre Muerto (Máquina 1).

    activo ──(Δ ≥ 0.75·U, armado)──► alerta ──(Δ ≥ U)──► gracia
      ▲  ▲  ▲                                              │  │
      │  │  └───────── señal de vida ─────────────────────┘  │ k·vida
      │  │                                                   ▼
      │  └── señal de vida ──────────────── gracia_reduccion ──(t ≥ R  ó  k·deceso
      │                                        │  ▲             ó  k·vida y recon = N)──► liberado
      └── señal de vida (propietario) ────────┘  └ k·vida y recon < N: reinicia R

    (activo | episodio en curso) ──solicitud de baja──► pausado_eliminacion ──cancelación──► activo
    (cualquiera salvo liberado) ──purga de la cuenta──► eliminado

`TRANSICIONES` es la única fuente de verdad: un cambio de estado que no esté
en la tabla no ocurre (`TransicionInvalida`). Qué hace el sistema al entrar
a cada estado está en `maquina.py`; qué evento ocurrió lo decide el
evaluador según tiempos y votos.
"""

import enum
from collections.abc import Mapping
from types import MappingProxyType

from app.models.usuario import EstadoDMS

E = EstadoDMS


class Evento(enum.StrEnum):
    inactividad = "inactividad"  # Δ ≥ 0.75·U con el interruptor armado
    inactividad_total = "inactividad_total"  # Δ ≥ U
    senal_de_vida = "senal_de_vida"  # login / check-in del propietario
    quorum_vida = "quorum_vida"  # k custodios votaron 'vida'
    quorum_fallecimiento = "quorum_fallecimiento"  # k custodios votaron 'fallecimiento'
    plazo_vencido = "plazo_vencido"  # se agotó G (gracia) o R (reducción)
    reconfirmaciones_agotadas = "reconfirmaciones_agotadas"
    eliminacion_solicitada = "eliminacion_solicitada"
    eliminacion_cancelada = "eliminacion_cancelada"
    cuenta_purgada = "cuenta_purgada"


# Episodio abierto: el roster y la asignación de fragmentos quedan congelados
# (ya puede haber tokens de voto que dependen de ellos).
EN_CURSO = frozenset({E.alerta, E.gracia, E.gracia_reduccion})
# Estados en los que los custodios pueden votar.
CON_VOTACION = frozenset({E.gracia, E.gracia_reduccion})
# El barrido periódico evalúa transiciones por tiempo solo desde estos.
EVALUABLES = frozenset({E.activo}) | EN_CURSO

TRANSICIONES: Mapping[tuple[EstadoDMS, Evento], EstadoDMS] = MappingProxyType(
    {
        (E.activo, Evento.inactividad): E.alerta,
        (E.alerta, Evento.inactividad_total): E.gracia,
        **{(estado, Evento.senal_de_vida): E.activo for estado in EN_CURSO},
        (E.gracia, Evento.quorum_vida): E.gracia_reduccion,
        (E.gracia_reduccion, Evento.quorum_vida): E.gracia_reduccion,  # reconfirmación: reinicia R
        **{(estado, Evento.quorum_fallecimiento): E.liberado for estado in CON_VOTACION},
        **{(estado, Evento.plazo_vencido): E.liberado for estado in CON_VOTACION},
        (E.gracia_reduccion, Evento.reconfirmaciones_agotadas): E.liberado,
        **{(estado, Evento.eliminacion_solicitada): E.pausado_eliminacion for estado in EVALUABLES},
        (E.pausado_eliminacion, Evento.eliminacion_cancelada): E.activo,
        **{
            (estado, Evento.cuenta_purgada): E.eliminado
            for estado in EVALUABLES | {E.pausado_eliminacion}
        },
    }
)


class TransicionInvalida(Exception):
    """El evento no aplica al estado actual (error de programación, no del usuario)."""


def siguiente(origen: EstadoDMS, evento: Evento) -> EstadoDMS:
    try:
        return TRANSICIONES[(EstadoDMS(origen), evento)]
    except KeyError:
        raise TransicionInvalida(f"El evento '{evento}' no aplica al estado '{origen}'.") from None
