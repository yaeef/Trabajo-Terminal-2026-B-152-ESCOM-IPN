"""
Plan vigente del propietario y su consumo de almacenamiento.

Módulo base (solo depende de los modelos): lo usan bóvedas, activos,
suscripciones y el panel, así ninguno de ellos tiene que importar a otro
para conocer el plan o el espacio usado.
"""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.tiempo import hoy
from app.models.activo import ActivoDigital, EstadoActivo
from app.models.boveda import Boveda
from app.models.suscripcion import PropietarioSuscripcion, Suscripcion
from app.models.usuario import Usuario

GB = 1024**3
ID_PLAN_GRATUITO = 1  # alta de cuenta y destino al vencer un plan de pago


def suscripcion_activa(db: Session, usuario: Usuario) -> PropietarioSuscripcion:
    """Contratación que cubre el día de hoy (fecha_inicio <= hoy < fecha_fin).
    Un plan de pago vencido ya no la cubre: la cubre el Gratuito que se
    agendó al contratarlo (ver suscripcion_service.aplicar_cambio).

    Todo propietario tiene siempre una: el alta crea la del Gratuito y cada
    cambio de plan cierra una y abre la siguiente el mismo día. Si faltara,
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
    """Plan de la contratación activa del propietario."""
    return suscripcion_activa(db, usuario).suscripcion


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
