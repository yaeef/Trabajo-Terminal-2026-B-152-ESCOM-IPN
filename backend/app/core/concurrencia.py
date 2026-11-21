# backend/app/core/concurrencia.py
"""
Límite de peticiones HTTP que la aplicación atiende a la vez.

Las rutas síncronas ocupan un hilo del grupo de AnyIO (40 hilos) para el
endpoint y otro para confirmar y cerrar la sesión de BD (db/sesion.py), y
retienen su conexión entre ambos pasos. Si hay más peticiones en curso que
hilos y conexiones juntos, los hilos pueden quedar todos esperando una
conexión que solo se libera cuando hay un hilo libre: el servidor se bloquea
hasta que vence la espera del pool (30 s). La prueba de carga lo mostró con
100 usuarios simultáneos.

Con a lo sumo `maximo` peticiones dentro de la aplicación (menos que hilos y
que conexiones), las demás esperan su turno en el bucle de eventos sin ocupar
hilo ni conexión.
"""

import asyncio

from starlette.types import ASGIApp, Receive, Scope, Send


class LimiteConcurrencia:
    def __init__(self, app: ASGIApp, maximo: int) -> None:
        self.app = app
        self._semaforo = asyncio.Semaphore(maximo)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        async with self._semaforo:
            await self.app(scope, receive, send)
