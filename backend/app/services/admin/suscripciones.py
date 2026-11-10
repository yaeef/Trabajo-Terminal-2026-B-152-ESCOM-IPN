# backend/app/services/admin/suscripciones.py
"""Estado de suscripción de un propietario y asignación manual de plan
(soporte, sin cobro) — uso del panel admin."""

from typing import Any

from sqlalchemy.orm import Session

from app.models.admin_auditoria import AccionAdmin
from app.models.usuario import Usuario
from app.services import suscripcion_service
from app.services.admin import auditoria, propietarios


def estado(db: Session, id_propietario: int) -> dict[str, Any]:
    usuario = propietarios.cargar_propietario(db, id_propietario)
    return suscripcion_service.obtener_estado(db, usuario)


def cambiar_plan(
    db: Session, admin: Usuario, id_propietario: int, id_plan: int, motivo: str
) -> dict[str, Any]:
    """Cambio manual de soporte: desde hoy queda en `id_plan` (ver
    `suscripcion_service.asignar_plan`); valida límites pero no exige pago."""
    usuario = propietarios.cargar_propietario(db, id_propietario)
    resultado = suscripcion_service.asignar_plan(db, usuario, id_plan)
    auditoria.registrar_accion(
        db, admin, AccionAdmin.cambiar_plan, motivo, id_propietario_afectado=id_propietario
    )
    return resultado
