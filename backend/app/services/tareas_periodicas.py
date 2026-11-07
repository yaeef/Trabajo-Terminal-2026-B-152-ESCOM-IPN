"""
Trabajo en segundo plano, en dos hilos daemon (sin dependencias extra):

- Entrega de notificaciones: cada pocos segundos, y al instante cuando se
  confirma una transacción que encoló avisos (ver services/notificaciones).
- Barrido periódico (cada hora):
    1. cola de eliminación de cuentas (periodo de gracia),
    2. Interruptor de Hombre Muerto de cada propietario (Máquina 1),
    3. ventana W de las bóvedas en recuperación (Máquina 2),
    4. limpieza de notificaciones ya resueltas.

Despliegue de un solo proceso: las marcas de fase en `propietario`
(dms_*_en, dms_ultimo_aviso) dan idempotencia si un barrido se repite.
"""

import logging
import threading
import time
from collections.abc import Callable
from typing import TypeVar

from sqlalchemy.orm import Session

from app.db.sesion import SessionLocal
from app.services import cuenta_service, dms, notificaciones

logger = logging.getLogger("b152.tareas")

T = TypeVar("T")

# La decisión de purgar/avanzar depende de fechas, no del tick: revisar cada
# hora solo acota cuánto puede retrasarse una transición o un recordatorio.
_INTERVALO_BARRIDO_SEG = 60 * 60
_ARRANQUE_SEG = 20  # primer barrido poco después de levantar la app
_INTERVALO_ENTREGA_SEG = 5
_iniciado = False


def _paso(db: Session, nombre: str, funcion: Callable[[Session], T]) -> T | None:
    """Un paso del barrido, aislado: si falla se revierte, se registra y
    devuelve None, y los pasos siguientes corren igual (una purga de cuenta
    fallida no debe impedir la evaluación del DMS de todos los propietarios)."""
    try:
        return funcion(db)
    except Exception:
        db.rollback()
        logger.exception("Fallo en el paso '%s' del barrido.", nombre)
        return None


def _barrido() -> None:
    db = SessionLocal()
    try:
        if purgadas := _paso(db, "cola de eliminación", cuenta_service.procesar_cola_eliminacion):
            logger.info("Cola de eliminación: %d cuenta(s) purgada(s).", purgadas)
        if (cambios := _paso(db, "DMS", dms.procesar_dms)) and any(cambios.values()):
            logger.info("Interruptor de Hombre Muerto: %s", cambios)
        if expiradas := _paso(db, "ventana de recuperación", dms.procesar_ventana_recuperacion):
            logger.info("Recuperación: %d bóveda(s) expiradas por ventana W.", expiradas)
        _paso(db, "limpieza de notificaciones", notificaciones.purgar_resueltas)
    finally:
        db.close()


def _entrega() -> None:
    db = SessionLocal()
    try:
        notificaciones.entregar_pendientes(db)
    except Exception:
        db.rollback()
        logger.exception("Fallo entregando notificaciones.")
    finally:
        db.close()


def _bucle(nombre: str, tarea: Callable[[], None], esperar: Callable[[], None]) -> None:
    while True:
        try:
            tarea()
        except Exception:  # nunca dejar morir el hilo por un fallo puntual
            logger.exception("Fallo en el hilo '%s'.", nombre)
        esperar()


def _bucle_barrido() -> None:
    time.sleep(_ARRANQUE_SEG)
    _bucle("barrido", _barrido, lambda: time.sleep(_INTERVALO_BARRIDO_SEG))


def _bucle_entrega() -> None:
    _bucle(
        "notificaciones", _entrega, lambda: notificaciones.esperar_trabajo(_INTERVALO_ENTREGA_SEG)
    )


def iniciar() -> None:
    """Idempotente: arranca los hilos una sola vez por proceso."""
    global _iniciado
    if _iniciado:
        return
    _iniciado = True
    threading.Thread(target=_bucle_barrido, name="b152-barrido", daemon=True).start()
    threading.Thread(target=_bucle_entrega, name="b152-notificaciones", daemon=True).start()
    logger.info(
        "Scheduler B152 iniciado (barrido cada %ds, notificaciones cada %ds).",
        _INTERVALO_BARRIDO_SEG,
        _INTERVALO_ENTREGA_SEG,
    )
