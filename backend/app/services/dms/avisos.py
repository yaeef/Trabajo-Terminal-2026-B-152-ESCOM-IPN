"""
Avisos del DMS al propietario y a sus custodios. Solo encolan (ver
services/notificaciones): salen si la transición se confirma.

El bot de Telegram no permite votar desde el chat: los mensajes llevan el
mismo enlace que el correo y el custodio actúa desde la página web.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.boveda import Boveda, CustodioBoveda, EstadoBoveda
from app.models.custodio import Custodio
from app.models.usuario import Propietario, Usuario
from app.services import notificaciones
from app.services.dms import roster


def nombre_propietario(usuario: Usuario) -> str:
    return (usuario.nombre or "").strip() or usuario.username


def _fecha(momento: datetime) -> str:
    return momento.strftime("%d/%m/%Y")


def _al_propietario(
    db: Session,
    usuario: Usuario,
    plantilla_correo: str,
    plantilla_telegram: str | None,
    **datos: Any,
) -> None:
    """A su correo principal, al secundario (si lo verificó) y a su Telegram vinculado."""
    datos["nombre"] = nombre_propietario(usuario)
    for correo in (usuario.correo, usuario.correo_sec):
        notificaciones.encolar_correo(db, correo, plantilla_correo, **datos)
    if plantilla_telegram:
        notificaciones.encolar_telegram(db, usuario.id_telegram, plantilla_telegram, **datos)


def _al_custodio(db: Session, custodio: Custodio, plantilla: str, **datos: Any) -> None:
    """Solo por los canales que el custodio verificó."""
    if custodio.correo and custodio.correo_verificado:
        notificaciones.encolar_correo(
            db, custodio.correo, plantilla, custodio=custodio.nombre or "custodio", **datos
        )
    if custodio.telegram_verificado:
        notificaciones.encolar_telegram(db, custodio.telegram_chat_id, plantilla, **datos)


def custodio_contactable(custodio: Custodio) -> bool:
    return bool(
        (custodio.correo and custodio.correo_verificado)
        or (custodio.telegram_verificado and custodio.telegram_chat_id)
    )


# --- Por estado --------------------------------------------------------------
def alerta(db: Session, prop: Propietario, usuario: Usuario, dias_restantes: int) -> None:
    """Al propietario y, a modo de aviso previo, a todo el roster."""
    _al_propietario(db, usuario, "dms_alerta", "dms_alerta", dias=dias_restantes)
    for custodio in roster.custodios_roster(db, prop):
        _al_custodio(db, custodio, "dms_alerta_custodio", propietario=nombre_propietario(usuario))


def gracia(db: Session, usuario: Usuario, fecha_limite: datetime) -> None:
    _al_propietario(db, usuario, "dms_gracia", "dms_gracia", fecha=_fecha(fecha_limite))


def recordatorio_gracia(db: Session, usuario: Usuario, fecha_limite: datetime) -> None:
    _al_propietario(
        db, usuario, "dms_gracia", "dms_recordatorio_gracia", fecha=_fecha(fecha_limite)
    )


def gracia_reduccion(db: Session, usuario: Usuario, fecha_limite: datetime) -> None:
    _al_propietario(
        db, usuario, "dms_gracia_reduccion", "dms_gracia_reduccion", fecha=_fecha(fecha_limite)
    )


def recordatorio_reduccion(db: Session, usuario: Usuario, fecha_limite: datetime) -> None:
    _al_propietario(db, usuario, "dms_gracia_reduccion", None, fecha=_fecha(fecha_limite))


def reactivado(db: Session, usuario: Usuario) -> None:
    _al_propietario(db, usuario, "dms_reactivado", None)


def voto(db: Session, custodio: Custodio, usuario: Usuario, token: str) -> None:
    enlace = f"{settings.FRONTEND_DMS_VOTO_URL}?token={token}"
    _al_custodio(
        db, custodio, "dms_voto_custodio", propietario=nombre_propietario(usuario), enlace=enlace
    )


def liberado(db: Session, prop: Propietario, usuario: Usuario) -> None:
    """
    Al propietario, y a cada custodio UN aviso con el PID y el enlace directo
    de CADA bóveda de este propietario que ya está 'en_recuperacion' y donde
    guarda un fragmento (puede ser más de una). Se consulta la asignación
    vigente, no el roster congelado: éste abarca todo el propietario sin
    filtrar por estado de cada bóveda, y aquí solo interesan las que de
    verdad entraron a recuperación.
    """
    _al_propietario(db, usuario, "dms_liberado", "dms_liberado")

    base = settings.FRONTEND_BASE_URL.rstrip("/")
    filas = db.execute(
        select(CustodioBoveda.id_custodio, Boveda)
        .join(Boveda, Boveda.id == CustodioBoveda.id_boveda)
        .where(Boveda.id_propietario == prop.id, Boveda.estado == EstadoBoveda.en_recuperacion)
        .order_by(Boveda.id)
    ).all()
    por_custodio: dict[int, list[dict[str, str]]] = {}
    for id_custodio, boveda in filas:
        por_custodio.setdefault(id_custodio, []).append(
            {
                "pid": boveda.pid,
                "nombre": boveda.nombre,
                "enlace": f"{base}/recuperacion/{boveda.pid}",
            }
        )
    if not por_custodio:
        return

    custodios = db.scalars(select(Custodio).where(Custodio.id.in_(por_custodio)))
    for custodio in custodios:
        _al_custodio(
            db,
            custodio,
            "dms_liberado_custodio",
            propietario=nombre_propietario(usuario),
            bovedas=por_custodio[custodio.id],
        )
