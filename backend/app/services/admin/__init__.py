"""
Panel de administración (soporte/operación de la plataforma).

    propietarios.py     búsqueda, detalle agregado, bóvedas (metadatos),
                        cancelar eliminación, purgar cuenta ahora
    dms.py              estado del DMS y acciones (reenviar aviso, extender
                        plazo, forzar el barrido)
    custodios.py        listar y reenviar verificación de un custodio ajeno
    suscripciones.py    estado del plan y cambio manual (sin PayPal)
    notificaciones.py   cola de avisos: listado y reintento manual
    auditoria.py        bitácora de toda acción admin (quién, sobre quién,
                        qué acción, por qué)

El admin autenticado (`AdminActual`, ver api/dependencias.py) solo se usa
para registrar la auditoría: nunca se pasa como "usuario actor" a las
funciones de dominio existentes (custodio_service, cuenta_service, ...),
que reciben el `Usuario` PROPIETARIO objetivo, cargado por
`propietarios.cargar_propietario`.

El admin opera solo sobre metadatos y transiciones de estado: nunca sobre
contenido de bóvedas, DEKs, fragmentos .sss ni coordenadas y (garantía
Zero-Knowledge).
"""

from app.services.admin import (
    auditoria,
    custodios,
    dms,
    notificaciones,
    propietarios,
    suscripciones,
)

__all__ = [
    "auditoria",
    "custodios",
    "dms",
    "notificaciones",
    "propietarios",
    "suscripciones",
]
