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
from app.models.boveda import Boveda, CustodioBoveda
from app.models.custodio import Custodio
from app.models.suscripcion import PropietarioSuscripcion, Suscripcion
from app.models.usuario import Usuario
from app.services.errores import Conflicto

MB = 1024**2
GB = 1024**3
ID_PLAN_GRATUITO = 1  # alta de cuenta y destino al terminar la cobertura de pago


class PlanConflicto(Conflicto):
    """La operación no cabe en el plan (límite alcanzado, ya lo tienes, etc.)."""


class LimiteArchivos(PlanConflicto):
    """Ya tiene todos los archivos que su plan permite (el frontend lo muestra
    en una ventana propia por su `codigo`)."""

    codigo = "limite_archivos"


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
    return int(plan_vigente(db, usuario).max_almacenamiento_mb) * MB


def tamano_legible(num_bytes: float) -> str:
    """512 MB, 1.5 GB, 50 GB… (para mensajes al usuario, nunca bytes sueltos)."""
    if num_bytes >= GB:
        texto = f"{num_bytes / GB:.1f}".removesuffix(".0")
        return f"{texto} GB"
    return f"{max(num_bytes, 0) / MB:.0f} MB"


def num_archivos(db: Session, usuario: Usuario) -> int:
    """Archivos subidos y confirmados en sus bóvedas. Las plantillas de
    credenciales no cuentan para el límite de archivos del plan."""
    total = db.scalar(
        select(func.count(ActivoDigital.id))
        .join(Boveda, Boveda.id == ActivoDigital.id_boveda)
        .where(
            Boveda.id_propietario == usuario.id,
            ActivoDigital.estado == EstadoActivo.activo,
            ActivoDigital.plantilla.is_(None),
        )
    )
    return int(total or 0)


def uso_y_cuota(db: Session, usuario: Usuario) -> tuple[int, int]:
    """(usado, cuota) en bytes — para validar subidas y el indicador de espacio."""
    return uso_bytes(db, usuario), cuota_bytes(db, usuario)


def num_bovedas(db: Session, usuario: Usuario) -> int:
    total = db.scalar(select(func.count(Boveda.id)).where(Boveda.id_propietario == usuario.id))
    return int(total or 0)


# Custodio de reemplazo: se puede registrar 1 más que el plan para sustituir a
# otro sin borrar la bóveda; en las bóvedas solo se usan los del plan.
RESERVA_CUSTODIOS = 1


def limite_registro_custodios(plan: Suscripcion) -> int:
    return plan.max_custodios + RESERVA_CUSTODIOS


def num_custodios(db: Session, usuario: Usuario) -> int:
    total = db.scalar(select(func.count(Custodio.id)).where(Custodio.id_propietario == usuario.id))
    return int(total or 0)


def uso_actual(db: Session, usuario: Usuario) -> dict[str, int]:
    """Forma de UsoActual: consumo real para compararlo con los límites de un plan."""
    return {
        "bovedas": num_bovedas(db, usuario),
        "custodios": num_custodios(db, usuario),
        "almacenamiento_bytes": uso_bytes(db, usuario),
        "archivos": num_archivos(db, usuario),
    }


def excesos(uso: dict[str, Any], plan: Suscripcion, *, custodios: bool = True) -> list[str]:
    """Qué parte del uso no cabe en `plan` (vacía si todo cabe). Con
    `custodios=False` solo cuenta lo que ocupa espacio (bóvedas y archivos):
    lo que el recorte por impago puede borrar."""
    problemas = []
    if uso["bovedas"] > plan.max_bovedas:
        problemas.append(f"{uso['bovedas']} bóvedas (el plan permite {plan.max_bovedas})")
    if custodios and uso["custodios"] > limite_registro_custodios(plan):
        problemas.append(
            f"{uso['custodios']} custodios (el plan permite {plan.max_custodios} "
            f"y {RESERVA_CUSTODIOS} de reemplazo)"
        )
    if uso["almacenamiento_bytes"] > plan.max_almacenamiento_mb * MB:
        problemas.append(
            f"{tamano_legible(uso['almacenamiento_bytes'])} usados "
            f"(el plan permite {tamano_legible(plan.max_almacenamiento_mb * MB)})"
        )
    if plan.max_archivos is not None and uso.get("archivos", 0) > plan.max_archivos:
        problemas.append(f"{uso['archivos']} archivos (el plan permite {plan.max_archivos})")
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
    if num_custodios(db, usuario) >= limite_registro_custodios(plan):
        raise PlanConflicto(
            f"Ya tienes {limite_registro_custodios(plan)} custodios: los {plan.max_custodios} de tu "
            f"plan «{plan.nombre}» y {RESERVA_CUSTODIOS} de reemplazo. Elimina uno o sube de plan "
            "para registrar más."
        )


def exigir_custodios_habilitados(
    db: Session, usuario: Usuario, id_boveda: int, ids_nuevos: set[int]
) -> None:
    """409 si, con la nueva asignación de `id_boveda`, el propietario usaría
    en sus bóvedas más custodios distintos de los que permite el plan (el de
    reemplazo solo entra quitando a otro)."""
    plan = plan_vigente(db, usuario)
    en_otras = db.scalars(
        select(CustodioBoveda.id_custodio)
        .join(Boveda, Boveda.id == CustodioBoveda.id_boveda)
        .where(Boveda.id_propietario == usuario.id, Boveda.id != id_boveda)
    ).all()
    usados = set(en_otras) | ids_nuevos
    if len(usados) > plan.max_custodios:
        raise PlanConflicto(
            f"Tu plan «{plan.nombre}» permite usar {plan.max_custodios} custodios en tus "
            f"bóvedas y con este cambio serían {len(usados)}. El custodio de reemplazo "
            "sirve para tomar el lugar de otro: quita a alguien para hacerle espacio."
        )


def exigir_cupo_archivo(db: Session, usuario: Usuario) -> None:
    """409 si subir otro archivo excede el límite de archivos del plan vigente
    (solo archivos subidos; las plantillas de credenciales no cuentan)."""
    plan = plan_vigente(db, usuario)
    if plan.max_archivos is not None and num_archivos(db, usuario) >= plan.max_archivos:
        raise LimiteArchivos(
            f"Tu plan «{plan.nombre}» permite {plan.max_archivos} archivos y ya los tienes. "
            "Borra uno o cámbiate a Premium para subir más. Las plantillas no tienen límite."
        )
