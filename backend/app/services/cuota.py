"""
Plan vigente del propietario, su consumo y los límites del plan.

Módulo base (solo depende de los modelos): lo usan bóvedas, activos,
custodios, suscripciones, impago y el panel, así ninguno de ellos tiene que
importar a otro para conocer el plan, el espacio usado o si cabe algo más.
"""

from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.tiempo import hoy
from app.models.activo import ActivoDigital, EstadoActivo
from app.models.boveda import Boveda
from app.models.custodio import Custodio
from app.models.suscripcion import PropietarioSuscripcion, Suscripcion
from app.models.usuario import Usuario
from app.services.errores import Conflicto

GB = 1024**3
ID_PLAN_GRATUITO = 1  # alta de cuenta y destino al terminar la cobertura de pago


class PlanConflicto(Conflicto):
    """La operación no cabe en el plan (límite alcanzado, ya lo tienes, etc.)."""


def suscripcion_activa(db: Session, usuario: Usuario) -> PropietarioSuscripcion:
    """Periodo que cubre el día de hoy (fecha_inicio <= hoy < fecha_fin).
    Al vencer un plan de pago lo cubre el periodo que se agendó a
    continuación: la gracia y la reserva si tiene año de reserva, o el
    Gratuito (ver suscripcion_service).

    Todo propietario tiene siempre uno: el alta crea el del Gratuito y cada
    cambio cierra un periodo y abre el siguiente el mismo día. Si faltara,
    es un bug y la petición falla (NoResultFound -> 500)."""
    dia = hoy()
    return db.execute(
        select(PropietarioSuscripcion)
        .where(
            PropietarioSuscripcion.id_propietario == usuario.id,
            PropietarioSuscripcion.fecha_inicio <= dia,
            or_(PropietarioSuscripcion.fecha_fin.is_(None), PropietarioSuscripcion.fecha_fin > dia),
        )
        .order_by(PropietarioSuscripcion.fecha_inicio.desc(), PropietarioSuscripcion.id.desc())
        .limit(1)
    ).scalar_one()


def plan_vigente(db: Session, usuario: Usuario) -> Suscripcion:
    """Plan del periodo activo del propietario."""
    return suscripcion_activa(db, usuario).suscripcion


def plan_gratuito(db: Session) -> Suscripcion:
    plan = db.get(Suscripcion, ID_PLAN_GRATUITO)
    if plan is None:  # el esquema siempre lo trae (db/init)
        raise RuntimeError("Falta el plan Gratuito en el catálogo.")
    return plan


# --------------------------------------------------------------------------
# Consumo
# --------------------------------------------------------------------------
def uso_bytes(db: Session, usuario: Usuario) -> int:
    """Bytes cifrados de los activos confirmados de todas sus bóvedas."""
    total = db.scalar(
        select(func.coalesce(func.sum(ActivoDigital.tamano_cifrado), 0))
        .join(Boveda, Boveda.id == ActivoDigital.id_boveda)
        .where(Boveda.id_propietario == usuario.id, ActivoDigital.estado == EstadoActivo.activo)
    )
    return int(total or 0)


def cuota_bytes(db: Session, usuario: Usuario) -> int:
    return int(plan_vigente(db, usuario).max_almacenamiento) * GB


def uso_y_cuota(db: Session, usuario: Usuario) -> tuple[int, int]:
    """(usado, cuota) en bytes — para validar subidas y el indicador de espacio."""
    return uso_bytes(db, usuario), cuota_bytes(db, usuario)


def num_bovedas(db: Session, usuario: Usuario) -> int:
    total = db.scalar(select(func.count(Boveda.id)).where(Boveda.id_propietario == usuario.id))
    return int(total or 0)


def num_custodios(db: Session, usuario: Usuario) -> int:
    total = db.scalar(select(func.count(Custodio.id)).where(Custodio.id_propietario == usuario.id))
    return int(total or 0)


def uso_actual(db: Session, usuario: Usuario) -> dict[str, int]:
    """Forma de UsoActual: consumo real para compararlo con los límites de un plan."""
    return {
        "bovedas": num_bovedas(db, usuario),
        "custodios": num_custodios(db, usuario),
        "almacenamiento_bytes": uso_bytes(db, usuario),
    }


def excesos(uso: dict[str, Any], plan: Suscripcion, *, custodios: bool = True) -> list[str]:
    """Qué parte del uso no cabe en `plan` (vacía si todo cabe). Con
    `custodios=False` solo cuenta lo que ocupa espacio (bóvedas y archivos):
    lo que el recorte por impago puede borrar."""
    problemas = []
    if uso["bovedas"] > plan.max_bovedas:
        problemas.append(f"{uso['bovedas']} bóvedas (el plan permite {plan.max_bovedas})")
    if custodios and uso["custodios"] > plan.max_custodios:
        problemas.append(f"{uso['custodios']} custodios (el plan permite {plan.max_custodios})")
    if uso["almacenamiento_bytes"] > plan.max_almacenamiento * GB:
        usados_gb = uso["almacenamiento_bytes"] / GB
        problemas.append(
            f"{usados_gb:.2f} GB usados (el plan permite {plan.max_almacenamiento} GB)"
        )
    return problemas


# --------------------------------------------------------------------------
# Guardas de límites (usadas por boveda_service / custodio_service)
# --------------------------------------------------------------------------
def exigir_cupo_boveda(db: Session, usuario: Usuario) -> None:
    """409 si crear otra bóveda excede el plan vigente."""
    plan = plan_vigente(db, usuario)
    if num_bovedas(db, usuario) >= plan.max_bovedas:
        raise PlanConflicto(
            f"Alcanzaste el límite de {plan.max_bovedas} bóveda(s) de tu plan «{plan.nombre}». "
            "Sube de plan para crear más."
        )


def exigir_cupo_custodio(db: Session, usuario: Usuario) -> None:
    """409 si registrar otro custodio excede el plan vigente."""
    plan = plan_vigente(db, usuario)
    if num_custodios(db, usuario) >= plan.max_custodios:
        raise PlanConflicto(
            f"Alcanzaste el límite de {plan.max_custodios} custodio(s) de tu plan «{plan.nombre}». "
            "Sube de plan para registrar más."
        )
