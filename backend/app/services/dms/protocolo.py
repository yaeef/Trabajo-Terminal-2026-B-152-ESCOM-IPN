"""Protocolo de vida del propietario: parámetros, señales de vida y bitácora."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.tiempo import ahora
from app.models.prueba_vida_log import MetodoPruebaVida, PruebaVidaLog
from app.models.usuario import Propietario, Usuario
from app.schemas.usuario import CheckinItem, HistorialCheckinsResponse, ProtocoloVidaRequest
from app.services.dms import estados, maquina
from app.services.dms.estados import Evento


def actualizar_protocolo_vida(
    db: Session, usuario: Usuario, datos: ProtocoloVidaRequest
) -> Propietario:
    """CU-015. La ruta exige PropietarioActual, así que `propietario`
    existe; los valores admitidos ({30,45,60} / {7,14,21}) los valida el schema."""
    prop = usuario.propietario
    assert prop is not None
    prop.periodicidad_prueba = datos.periodicidad_prueba
    prop.periodicidad_periodo_gracia = datos.periodicidad_periodo_gracia
    db.flush()
    return prop


def registrar_prueba_de_vida(
    db: Session,
    usuario: Usuario,
    metodo: MetodoPruebaVida,
    identificador: str | None = None,
    ip_origen: str | None = None,
) -> None:
    """
    RF-010/RF-011. Actualiza `ultima_prueba`, deja constancia en
    `prueba_vida_log` y, si había un episodio en curso, lo cierra (vuelve a
    'activo'). Nunca revierte desde 'liberado'.
    """
    prop = usuario.propietario
    if prop is None:
        return
    prop.ultima_prueba = ahora()
    db.add(
        PruebaVidaLog(
            id_propietario=prop.id,
            metodo=metodo,
            identificador=identificador,
            ip_origen=ip_origen,
            dias_extendidos=prop.periodicidad_prueba or 60,
        )
    )
    if prop.status_dms in estados.EN_CURSO:
        maquina.disparar(db, prop, Evento.senal_de_vida)


def historial_checkins(
    db: Session, usuario: Usuario, limite: int = 50
) -> HistorialCheckinsResponse:
    """Alimenta el Historial de Check-ins: stats + los `limite` registros más
    recientes de la bitácora (se piden con LIMIT: la bitácora crece con cada
    inicio de sesión y no se carga completa)."""
    prop = usuario.propietario
    assert prop is not None
    recientes = db.scalars(
        select(PruebaVidaLog)
        .where(PruebaVidaLog.id_propietario == prop.id)
        .order_by(PruebaVidaLog.fecha_prueba.desc(), PruebaVidaLog.id.desc())
        .limit(limite)
    )
    return HistorialCheckinsResponse(
        inactividad_permitida=prop.periodicidad_prueba,
        ultima_senal=prop.ultima_prueba,
        estado_interruptor=prop.status_dms,
        logs=[CheckinItem.model_validate(log) for log in recientes],
    )


def anonimizar_bitacora(usuario: Usuario) -> None:
    """Derecho al olvido: se borran identificador e IP, se conserva la auditoría."""
    if usuario.propietario is None:
        return
    for log in usuario.propietario.pruebas_vida:
        log.identificador = None
        log.ip_origen = None
