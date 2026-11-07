"""
Avisos salientes por correo y Telegram (outbox transaccional).

Uso desde un caso de uso, dentro de su transacción:

    notificaciones.encolar_correo(db, custodio.correo, "custodio_verificacion",
                                  custodio=..., propietario=..., enlace=...)

El aviso sale solo si la transacción se confirma (ver `cola.py`); las
plantillas viven en `plantillas/` y los transportes en `transportes.py`.
"""

from app.services.notificaciones.cola import (
    encolar_correo,
    encolar_telegram,
    entregar_pendientes,
    esperar_trabajo,
    purgar_resueltas,
)

__all__ = [
    "encolar_correo",
    "encolar_telegram",
    "entregar_pendientes",
    "esperar_trabajo",
    "purgar_resueltas",
]
