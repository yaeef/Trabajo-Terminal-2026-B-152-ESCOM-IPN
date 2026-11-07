# backend/app/services/admin/dms.py
"""Estado del Interruptor de Hombre Muerto de un propietario y acciones de
soporte sobre él (reenviar aviso, extender plazo, forzar el barrido) — uso
del panel admin."""

from typing import Any

from sqlalchemy.orm import Session

from app.core.tiempo import ahora
from app.models.admin_auditoria import AccionAdmin
from app.models.usuario import Usuario
from app.services.admin import auditoria, propietarios
from app.services.dms import evaluar, resumen_liberacion
from app.services.dms import extender_plazo as _extender_plazo_dms
from app.services.dms import recordar_ahora as _recordar_ahora
from app.services.dms.estados import CON_VOTACION, EN_CURSO
from app.services.dms.votos import conteo as _contar_votos
from app.services.errores import DatoInvalido


def estado(db: Session, id_propietario: int) -> dict[str, Any]:
    """Forma de DmsEstadoResponse."""
    usuario = propietarios.cargar_propietario(db, id_propietario)
    prop = usuario.propietario
    if prop is None:
        raise DatoInvalido(
            "Esta cuenta no tiene protocolo de vida (no es un propietario operable)."
        )
    votos = _contar_votos(db, prop)
    return {
        "status_dms": prop.status_dms,
        "dms_ronda": prop.dms_ronda,
        "dms_quorum": prop.dms_quorum,
        "dms_reconfirmaciones": prop.dms_reconfirmaciones,
        "dms_alerta_en": prop.dms_alerta_en,
        "dms_gracia_en": prop.dms_gracia_en,
        "dms_reduccion_hasta": prop.dms_reduccion_hasta,
        "dms_ultimo_aviso": prop.dms_ultimo_aviso,
        "votos": {"vida": votos.vida, "fallecimiento": votos.fallecimiento},
        "resumen_liberacion": resumen_liberacion(db, usuario),
    }


def reenviar_aviso(db: Session, admin: Usuario, id_propietario: int, motivo: str) -> None:
    usuario = propietarios.cargar_propietario(db, id_propietario)
    prop = usuario.propietario
    if prop is None or prop.status_dms not in EN_CURSO:
        raise DatoInvalido(
            "Solo se puede reenviar el aviso con un episodio del DMS en curso "
            "('alerta', 'gracia' o 'gracia_reduccion')."
        )
    _recordar_ahora(db, prop, ahora())
    auditoria.registrar_accion(
        db, admin, AccionAdmin.reenviar_aviso_dms, motivo, id_propietario_afectado=id_propietario
    )


def extender_plazo(
    db: Session, admin: Usuario, id_propietario: int, dias: int, motivo: str
) -> None:
    usuario = propietarios.cargar_propietario(db, id_propietario)
    prop = usuario.propietario
    if prop is None or prop.status_dms not in CON_VOTACION:
        raise DatoInvalido(
            "Solo se puede extender el plazo con una votación de DMS abierta "
            "('gracia' o 'gracia_reduccion')."
        )
    _extender_plazo_dms(db, prop, dias)
    auditoria.registrar_accion(
        db, admin, AccionAdmin.extender_plazo_dms, motivo, id_propietario_afectado=id_propietario
    )


def forzar_barrido(db: Session, admin: Usuario, id_propietario: int, motivo: str) -> str | None:
    usuario = propietarios.cargar_propietario(db, id_propietario)
    prop = usuario.propietario
    if prop is None:
        raise DatoInvalido(
            "Esta cuenta no tiene protocolo de vida (no es un propietario operable)."
        )
    resultado = evaluar(db, prop, ahora())
    auditoria.registrar_accion(
        db, admin, AccionAdmin.forzar_barrido_dms, motivo, id_propietario_afectado=id_propietario
    )
    return resultado
