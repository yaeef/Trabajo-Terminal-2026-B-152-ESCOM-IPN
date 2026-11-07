# backend/app/services/admin/auditoria.py
"""Bitácora append-only de acciones del panel admin (ver
app/models/admin_auditoria.py): toda acción admin que modifica datos
termina llamando a `registrar_accion` antes de retornar."""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.admin_auditoria import AccionAdmin, AdminAuditoria
from app.models.usuario import Usuario


def registrar_accion(
    db: Session,
    admin: Usuario,
    accion: AccionAdmin,
    motivo: str,
    id_propietario_afectado: int | None = None,
) -> AdminAuditoria:
    """Agrega la fila a la transacción en curso: la acción y su registro se
    confirman (o revierten) juntos."""
    fila = AdminAuditoria(
        id_admin=admin.id,
        id_propietario_afectado=id_propietario_afectado,
        accion=accion,
        motivo=motivo,
    )
    db.add(fila)
    db.flush()
    return fila


def listar(
    db: Session,
    *,
    id_propietario: int | None = None,
    accion: AccionAdmin | None = None,
    limite: int = 50,
) -> dict[str, Any]:
    """Forma de AuditoriaListaResponse: total filtrado + las `limite` más recientes."""
    consulta = select(AdminAuditoria)
    if id_propietario is not None:
        consulta = consulta.where(AdminAuditoria.id_propietario_afectado == id_propietario)
    if accion is not None:
        consulta = consulta.where(AdminAuditoria.accion == accion)
    total = db.scalar(select(func.count()).select_from(consulta.subquery())) or 0
    filas = list(db.scalars(consulta.order_by(AdminAuditoria.creado_en.desc()).limit(limite)))
    return {"total": total, "resultados": filas}
