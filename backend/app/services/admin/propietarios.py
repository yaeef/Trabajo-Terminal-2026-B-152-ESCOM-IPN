# backend/app/services/admin/propietarios.py
"""Búsqueda, detalle agregado y acciones de cuenta (cancelar eliminación,
purgar ahora) sobre un propietario — uso del panel admin.

Nunca toca contenido de bóvedas, DEKs, fragmentos .sss ni coordenadas y:
solo metadatos (garantía Zero-Knowledge)."""

from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import seguridad
from app.models.admin_auditoria import AccionAdmin
from app.models.boveda import Boveda
from app.models.custodio import Custodio
from app.models.usuario import EstadoDMS, RolUsuario, Usuario
from app.services import boveda_service, cuenta_service, cuota
from app.services.admin import auditoria
from app.services.errores import Conflicto, DatoInvalido, NoEncontrado


class PropietarioNoEncontrado(NoEncontrado):
    """El id no corresponde a ningún propietario -> 404."""


def cargar_propietario(db: Session, id_propietario: int) -> Usuario:
    """El `Usuario` propietario objetivo de una acción admin (404 si no lo es)."""
    usuario = db.get(Usuario, id_propietario)
    if usuario is None or usuario.rol != RolUsuario.propietario:
        raise PropietarioNoEncontrado("Propietario no encontrado.")
    return usuario


def _plan_nombre(db: Session, usuario: Usuario) -> str:
    return cuota.plan_vigente(db, usuario).nombre


def buscar(db: Session, *, q: str | None, pagina: int, tam_pagina: int) -> dict[str, Any]:
    """Forma de PropietariosListaResponse: búsqueda paginada por username,
    nombre o correo (subcadena, sin distinguir mayúsculas)."""
    consulta = select(Usuario).where(Usuario.rol == RolUsuario.propietario)
    if q:
        patron = f"%{q}%"
        consulta = consulta.where(
            or_(
                Usuario.username.ilike(patron),
                Usuario.nombre.ilike(patron),
                Usuario.correo.ilike(patron),
            )
        )
    total = db.scalar(select(func.count()).select_from(consulta.subquery())) or 0
    filas = list(
        db.scalars(
            consulta.order_by(Usuario.id.desc()).offset((pagina - 1) * tam_pagina).limit(tam_pagina)
        )
    )
    resultados = [
        {
            "id": u.id,
            "username": u.username,
            "nombre": u.nombre,
            "correo": u.correo,
            "created_at": u.created_at,
            "status_dms": u.status_dms,
            "plan_nombre": _plan_nombre(db, u),
            "eliminacion_solicitada_en": u.eliminacion_solicitada_en,
        }
        for u in filas
    ]
    return {"total": total, "pagina": pagina, "tam_pagina": tam_pagina, "resultados": resultados}


def detalle(db: Session, id_propietario: int) -> dict[str, Any]:
    """Forma de PropietarioDetalleResponse."""
    usuario = cargar_propietario(db, id_propietario)
    bovedas_total = (
        db.scalar(select(func.count(Boveda.id)).where(Boveda.id_propietario == usuario.id)) or 0
    )
    custodios_total = (
        db.scalar(select(func.count(Custodio.id)).where(Custodio.id_propietario == usuario.id)) or 0
    )
    usado, cupo = cuota.uso_y_cuota(db, usuario)
    return {
        "id": usuario.id,
        "username": usuario.username,
        "nombre": usuario.nombre,
        "correo": usuario.correo,
        "created_at": usuario.created_at,
        "status_dms": usuario.status_dms,
        "eliminacion_solicitada_en": usuario.eliminacion_solicitada_en,
        "eliminacion_purga_en": usuario.eliminacion_purga_en,
        "plan_nombre": _plan_nombre(db, usuario),
        "bovedas_total": bovedas_total,
        "custodios_total": custodios_total,
        "usado_bytes": usado,
        "cuota_bytes": cupo,
    }


def bovedas(db: Session, id_propietario: int) -> list[dict[str, Any]]:
    """Metadatos de las bóvedas del propietario (nunca su contenido)."""
    usuario = cargar_propietario(db, id_propietario)
    return boveda_service.listar_bovedas(db, usuario)


def cancelar_eliminacion(db: Session, admin: Usuario, id_propietario: int, motivo: str) -> None:
    usuario = cargar_propietario(db, id_propietario)
    if usuario.eliminacion_solicitada_en is None:
        raise DatoInvalido("Esta cuenta no tiene una solicitud de eliminación pendiente.")
    cuenta_service.cancelar_eliminacion(db, usuario)
    auditoria.registrar_accion(
        db, admin, AccionAdmin.cancelar_eliminacion, motivo, id_propietario_afectado=usuario.id
    )


def purgar_ahora(
    db: Session, admin: Usuario, id_propietario: int, motivo: str, contrasena_admin: str
) -> None:
    if not seguridad.verificar_contrasena(contrasena_admin, admin.hash_pass):
        raise DatoInvalido("Contraseña de administrador incorrecta.")
    usuario = cargar_propietario(db, id_propietario)
    if usuario.status_dms in (EstadoDMS.liberado, EstadoDMS.eliminado):
        raise Conflicto("Esta cuenta ya está liberada o eliminada; no se puede purgar de nuevo.")
    cuenta_service.purgar_ahora_admin(db, usuario)
    auditoria.registrar_accion(
        db, admin, AccionAdmin.purgar_cuenta, motivo, id_propietario_afectado=id_propietario
    )
