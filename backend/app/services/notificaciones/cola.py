"""
Outbox transaccional: encolar dentro de la transacción del caso de uso y
entregar después, con reintentos.

- `encolar_*` solo inserta una fila `notificacion` (sin commit): si el caso
  de uso se revierte, el aviso desaparece con él; si se confirma, el aviso
  queda garantizado aunque el SMTP o Telegram estén caídos en ese momento.
- `entregar_pendientes` lo corre el worker (services/tareas_periodicas.py) cada
  pocos segundos, y al instante cuando una transacción con avisos confirma.
  Cada notificación se confirma por separado.

Despliegue de un solo proceso (igual que las tareas periódicas): no hay reparto de
filas entre varios workers.
"""

import logging
import threading
from datetime import datetime, timedelta
from typing import Any

from cryptography.fernet import InvalidToken
from jinja2 import TemplateError
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tiempo import ahora
from app.models.notificacion import CanalNotificacion, EstadoNotificacion, Notificacion
from app.services.notificaciones import cifrado, plantillas, transportes

logger = logging.getLogger("b152.notificaciones")

# Espera antes de cada reintento; agotada la lista, la notificación se da por perdida.
ESPERAS_REINTENTO = (
    timedelta(seconds=30),
    timedelta(minutes=2),
    timedelta(minutes=10),
    timedelta(hours=1),
    timedelta(hours=6),
)
MAX_INTENTOS = len(ESPERAS_REINTENTO) + 1
# Las ya resueltas (enviadas o perdidas) se borran pasado este tiempo: el
# destino es un dato personal y no hace falta conservarlo.
RETENCION = timedelta(days=30)

_hay_trabajo = threading.Event()
_CLAVE_SESION = "b152_notificaciones_encoladas"


def _para_bd(momento: datetime) -> datetime:
    """Las columnas DATETIME guardan UTC sin zona (ver core/tiempo.py)."""
    return momento.replace(tzinfo=None)


def _encolar(
    db: Session, canal: CanalNotificacion, destino: str, plantilla: str, datos: dict[str, Any]
) -> None:
    db.add(
        Notificacion(
            canal=canal,
            destino=destino,
            plantilla=plantilla,
            datos_cifrados=cifrado.cifrar(datos),
            estado=EstadoNotificacion.pendiente,
            intentos=0,
            siguiente_intento_en=_para_bd(ahora()),
        )
    )
    db.info[_CLAVE_SESION] = True


def encolar_correo(db: Session, destino: str | None, plantilla: str, **datos: Any) -> None:
    """Sin destino no hay nada que enviar (p. ej. correo secundario vacío)."""
    if not plantillas.existe_correo(plantilla):
        raise ValueError(f"Plantilla de correo desconocida: {plantilla!r}")
    if destino:
        _encolar(db, CanalNotificacion.correo, destino, plantilla, datos)


def encolar_telegram(db: Session, chat_id: str | int | None, plantilla: str, **datos: Any) -> None:
    """Sin bot configurado o sin chat vinculado, el canal simplemente no aplica."""
    if not plantillas.existe_telegram(plantilla):
        raise ValueError(f"Plantilla de Telegram desconocida: {plantilla!r}")
    if chat_id and settings.TELEGRAM_BOT_TOKEN:
        _encolar(db, CanalNotificacion.telegram, str(chat_id), plantilla, datos)


@event.listens_for(Session, "after_commit")
def _despertar_worker(sesion: Session) -> None:
    if sesion.info.pop(_CLAVE_SESION, False):
        _hay_trabajo.set()


@event.listens_for(Session, "after_rollback")
def _olvidar_encoladas(sesion: Session) -> None:
    sesion.info.pop(_CLAVE_SESION, None)


def esperar_trabajo(timeout: float) -> None:
    """Bloquea hasta que se confirme una transacción con avisos o pase `timeout`."""
    _hay_trabajo.wait(timeout)
    _hay_trabajo.clear()


def _entregar(fila: Notificacion) -> None:
    if fila.datos_cifrados is None:
        raise transportes.ErrorPermanente("La notificación ya no tiene datos")
    datos = cifrado.descifrar(fila.datos_cifrados)
    if fila.canal is CanalNotificacion.correo:
        asunto, html = plantillas.correo(fila.plantilla, datos)
        transportes.enviar_correo(fila.destino, asunto, html)
    else:
        transportes.enviar_telegram(fila.destino, plantillas.telegram(fila.plantilla, datos))


def _cerrar(fila: Notificacion, estado: EstadoNotificacion, error: str | None = None) -> None:
    fila.estado = estado
    fila.ultimo_error = error[:255] if error else None
    fila.datos_cifrados = None  # llevan tokens y datos personales: fuera en cuanto se resuelve
    if estado is EstadoNotificacion.enviada:
        fila.enviada_en = _para_bd(ahora())


def entregar_pendientes(db: Session, limite: int = 50) -> int:
    """Intenta entregar las notificaciones que ya tocan. Devuelve cuántas salieron."""
    ids = db.scalars(
        select(Notificacion.id)
        .where(
            Notificacion.estado == EstadoNotificacion.pendiente,
            Notificacion.siguiente_intento_en <= _para_bd(ahora()),
        )
        .order_by(Notificacion.id)
        .limit(limite)
    ).all()

    enviadas = 0
    for id_ in ids:
        fila = db.get(Notificacion, id_)
        if fila is None or fila.estado is not EstadoNotificacion.pendiente:
            continue
        fila.intentos += 1
        try:
            _entregar(fila)
        except (transportes.ErrorPermanente, InvalidToken, TemplateError, KeyError) as exc:
            _cerrar(fila, EstadoNotificacion.fallida, f"{type(exc).__name__}: {exc}")
            logger.error(
                "Notificación %s (%s) descartada: %s", fila.id, fila.plantilla, fila.ultimo_error
            )
        except transportes.ErrorTemporal as exc:
            if fila.intentos >= MAX_INTENTOS:
                _cerrar(fila, EstadoNotificacion.fallida, str(exc))
                logger.error(
                    "Notificación %s (%s) agotó sus reintentos: %s", fila.id, fila.plantilla, exc
                )
            else:
                fila.ultimo_error = str(exc)[:255]
                fila.siguiente_intento_en = _para_bd(ahora() + ESPERAS_REINTENTO[fila.intentos - 1])
                logger.warning(
                    "Notificación %s (%s) se reintentará: %s", fila.id, fila.plantilla, exc
                )
        else:
            _cerrar(fila, EstadoNotificacion.enviada)
            enviadas += 1
        db.commit()
    return enviadas


def purgar_resueltas(db: Session) -> int:
    """Borra las notificaciones enviadas o perdidas más viejas que RETENCION."""
    limite = _para_bd(ahora() - RETENCION)
    resultado = db.execute(
        delete(Notificacion).where(
            Notificacion.estado != EstadoNotificacion.pendiente,
            Notificacion.creada_en < limite,
        )
    )
    db.commit()
    return int(getattr(resultado, "rowcount", 0) or 0)
