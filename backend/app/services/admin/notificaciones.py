# backend/app/services/admin/notificaciones.py
"""Cola de notificaciones (correo/Telegram): listado de soporte y reintento
manual de las pendientes — uso del panel admin.

Una notificación 'fallida' agotó sus reintentos y ya perdió sus
`datos_cifrados` al cerrarse (ver app/services/notificaciones/cola.py): no
hay forma de "revivirla" desde aquí, solo de reintentar las 'pendiente'
cuyo backoff ya venció."""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.admin_auditoria import AccionAdmin
from app.models.notificacion import CanalNotificacion, EstadoNotificacion, Notificacion
from app.models.usuario import Usuario
from app.services import notificaciones as cola
from app.services.admin import auditoria


def listar(
    db: Session,
    *,
    estado: EstadoNotificacion | None = None,
    canal: CanalNotificacion | None = None,
    limite: int = 50,
) -> dict[str, Any]:
    consulta = select(Notificacion)
    if estado is not None:
        consulta = consulta.where(Notificacion.estado == estado)
    if canal is not None:
        consulta = consulta.where(Notificacion.canal == canal)
    total = db.scalar(select(func.count()).select_from(consulta.subquery())) or 0
    filas = list(db.scalars(consulta.order_by(Notificacion.creada_en.desc()).limit(limite)))
    return {"total": total, "resultados": filas}


def reintentar_pendientes(db: Session, admin: Usuario, motivo: str) -> int:
    """Corre ya una entrega de las pendientes que tocan (no adelanta las que
    siguen en espera de reintento). Devuelve cuántas salieron."""
    enviadas = cola.entregar_pendientes(db)
    auditoria.registrar_accion(db, admin, AccionAdmin.reintentar_notificaciones, motivo)
    return enviadas
