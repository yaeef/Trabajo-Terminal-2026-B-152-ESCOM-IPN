# backend/app/api/routes/admin.py
"""
Panel de administración (soporte/operación) — ver app/services/admin/.

Todas las rutas exigen `AdminActual` (rol admin). El admin opera solo sobre
metadatos y transiciones de estado: nunca sobre contenido de bóvedas, DEKs,
fragmentos .sss ni coordenadas y (garantía Zero-Knowledge).
"""

from typing import Any

from fastapi import APIRouter

from app.api.dependencias import AdminActual, SesionBD
from app.models.custodio import Custodio
from app.models.notificacion import CanalNotificacion, EstadoNotificacion
from app.schemas.admin import (
    AccionAdminRequest,
    AuditoriaListaResponse,
    BarridoResultado,
    CambiarPlanAdminRequest,
    DmsEstadoResponse,
    ExtenderPlazoRequest,
    NotificacionesListaResponse,
    PropietarioDetalleResponse,
    PropietariosListaResponse,
    PurgarCuentaAdminRequest,
    ReintentoNotificacionesResponse,
)
from app.schemas.boveda import BovedaResponse
from app.schemas.custodio import CustodioResponse
from app.schemas.suscripcion import PlanActualResponse, PlanResponse
from app.services import suscripcion_service
from app.services.admin import auditoria
from app.services.admin import custodios as admin_custodios
from app.services.admin import dms as admin_dms
from app.services.admin import notificaciones as admin_notificaciones
from app.services.admin import propietarios as admin_propietarios
from app.services.admin import suscripciones as admin_suscripciones

router = APIRouter()


# --------------------------------------------------------------------------
# Propietarios: búsqueda, detalle, bóvedas (metadatos), cuenta
# --------------------------------------------------------------------------
@router.get("/propietarios", response_model=PropietariosListaResponse)
def buscar_propietarios(
    admin: AdminActual,
    db: SesionBD,
    q: str | None = None,
    pagina: int = 1,
    tam_pagina: int = 20,
) -> dict[str, Any]:
    return admin_propietarios.buscar(
        db, q=q, pagina=max(pagina, 1), tam_pagina=min(max(tam_pagina, 1), 100)
    )


@router.get("/propietarios/{id_propietario}", response_model=PropietarioDetalleResponse)
def detalle_propietario(id_propietario: int, admin: AdminActual, db: SesionBD) -> dict[str, Any]:
    return admin_propietarios.detalle(db, id_propietario)


@router.get("/propietarios/{id_propietario}/bovedas", response_model=list[BovedaResponse])
def bovedas_de_propietario(
    id_propietario: int, admin: AdminActual, db: SesionBD
) -> list[dict[str, Any]]:
    return admin_propietarios.bovedas(db, id_propietario)


@router.post("/propietarios/{id_propietario}/cuenta/cancelar-eliminacion")
def cancelar_eliminacion(
    id_propietario: int, datos: AccionAdminRequest, admin: AdminActual, db: SesionBD
) -> dict[str, str]:
    admin_propietarios.cancelar_eliminacion(db, admin, id_propietario, datos.motivo)
    return {"detail": "Se canceló la eliminación de esa cuenta."}


@router.post("/propietarios/{id_propietario}/cuenta/purgar-ahora")
def purgar_cuenta_ahora(
    id_propietario: int, datos: PurgarCuentaAdminRequest, admin: AdminActual, db: SesionBD
) -> dict[str, str]:
    admin_propietarios.purgar_ahora(db, admin, id_propietario, datos.motivo, datos.contrasena_admin)
    return {"detail": "La cuenta fue purgada de inmediato."}


# --------------------------------------------------------------------------
# DMS
# --------------------------------------------------------------------------
@router.get("/propietarios/{id_propietario}/dms", response_model=DmsEstadoResponse)
def estado_dms(id_propietario: int, admin: AdminActual, db: SesionBD) -> dict[str, Any]:
    return admin_dms.estado(db, id_propietario)


@router.post("/propietarios/{id_propietario}/dms/reenviar-aviso")
def reenviar_aviso_dms(
    id_propietario: int, datos: AccionAdminRequest, admin: AdminActual, db: SesionBD
) -> dict[str, str]:
    admin_dms.reenviar_aviso(db, admin, id_propietario, datos.motivo)
    return {"detail": "Se reenvió el aviso del estado vigente."}


@router.post("/propietarios/{id_propietario}/dms/extender-plazo")
def extender_plazo_dms(
    id_propietario: int, datos: ExtenderPlazoRequest, admin: AdminActual, db: SesionBD
) -> dict[str, str]:
    admin_dms.extender_plazo(db, admin, id_propietario, datos.dias, datos.motivo)
    return {"detail": f"Se extendió el plazo {datos.dias} día(s)."}


@router.post("/propietarios/{id_propietario}/dms/forzar-barrido", response_model=BarridoResultado)
def forzar_barrido_dms(
    id_propietario: int, datos: AccionAdminRequest, admin: AdminActual, db: SesionBD
) -> dict[str, Any]:
    transicion = admin_dms.forzar_barrido(db, admin, id_propietario, datos.motivo)
    return {"transicion": transicion}


# --------------------------------------------------------------------------
# Custodios
# --------------------------------------------------------------------------
@router.get("/propietarios/{id_propietario}/custodios", response_model=list[CustodioResponse])
def listar_custodios(id_propietario: int, admin: AdminActual, db: SesionBD) -> list[Custodio]:
    return admin_custodios.listar(db, id_propietario)


@router.post(
    "/propietarios/{id_propietario}/custodios/{id_custodio}/reenviar-verificacion",
    response_model=CustodioResponse,
)
def reenviar_verificacion_custodio(
    id_propietario: int,
    id_custodio: int,
    datos: AccionAdminRequest,
    admin: AdminActual,
    db: SesionBD,
) -> Custodio:
    return admin_custodios.reenviar_verificacion(
        db, admin, id_propietario, id_custodio, datos.motivo
    )


# --------------------------------------------------------------------------
# Suscripción
# --------------------------------------------------------------------------
@router.get("/planes", response_model=list[PlanResponse])
def listar_planes(admin: AdminActual, db: SesionBD) -> list[dict[str, Any]]:
    """Catálogo de planes para elegir el destino de un cambio manual.

    A diferencia de GET /suscripciones/planes (gateado por
    `PropietarioActual`, rechaza admins), este no depende de tener cuenta
    de propietario: es solo el catálogo, igual para cualquier admin.
    """
    return suscripcion_service.listar_planes(db)


@router.get("/propietarios/{id_propietario}/suscripcion", response_model=PlanActualResponse)
def estado_suscripcion(id_propietario: int, admin: AdminActual, db: SesionBD) -> dict[str, Any]:
    return admin_suscripciones.estado(db, id_propietario)


@router.post(
    "/propietarios/{id_propietario}/suscripcion/cambiar-plan", response_model=PlanActualResponse
)
def cambiar_plan_admin(
    id_propietario: int, datos: CambiarPlanAdminRequest, admin: AdminActual, db: SesionBD
) -> dict[str, Any]:
    return admin_suscripciones.cambiar_plan(db, admin, id_propietario, datos.id_plan, datos.motivo)


# --------------------------------------------------------------------------
# Notificaciones
# --------------------------------------------------------------------------
@router.get("/notificaciones", response_model=NotificacionesListaResponse)
def listar_notificaciones(
    admin: AdminActual,
    db: SesionBD,
    estado: EstadoNotificacion | None = None,
    canal: CanalNotificacion | None = None,
) -> dict[str, Any]:
    return admin_notificaciones.listar(db, estado=estado, canal=canal)


@router.post(
    "/notificaciones/reintentar-pendientes", response_model=ReintentoNotificacionesResponse
)
def reintentar_notificaciones(
    datos: AccionAdminRequest, admin: AdminActual, db: SesionBD
) -> dict[str, int]:
    enviadas = admin_notificaciones.reintentar_pendientes(db, admin, datos.motivo)
    return {"enviadas": enviadas}


# --------------------------------------------------------------------------
# Auditoría
# --------------------------------------------------------------------------
@router.get("/auditoria", response_model=AuditoriaListaResponse)
def listar_auditoria(
    admin: AdminActual,
    db: SesionBD,
    id_propietario: int | None = None,
) -> dict[str, Any]:
    return auditoria.listar(db, id_propietario=id_propietario)
