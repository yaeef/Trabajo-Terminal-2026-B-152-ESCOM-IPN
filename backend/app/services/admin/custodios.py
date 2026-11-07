# backend/app/services/admin/custodios.py
"""Directorio de custodios de un propietario y reenvío de su verificación de
correo — uso del panel admin."""

from sqlalchemy.orm import Session

from app.models.admin_auditoria import AccionAdmin
from app.models.custodio import Custodio
from app.models.usuario import Usuario
from app.services import custodio_service
from app.services.admin import auditoria, propietarios


def listar(db: Session, id_propietario: int) -> list[Custodio]:
    usuario = propietarios.cargar_propietario(db, id_propietario)
    return custodio_service.listar_custodios(db, usuario)


def reenviar_verificacion(
    db: Session, admin: Usuario, id_propietario: int, id_custodio: int, motivo: str
) -> Custodio:
    usuario = propietarios.cargar_propietario(db, id_propietario)
    custodio = custodio_service.reenviar_verificacion_correo(db, usuario, id_custodio)
    auditoria.registrar_accion(
        db,
        admin,
        AccionAdmin.reenviar_verificacion_custodio,
        motivo,
        id_propietario_afectado=id_propietario,
    )
    return custodio
