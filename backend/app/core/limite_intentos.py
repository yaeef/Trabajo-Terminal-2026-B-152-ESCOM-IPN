# backend/app/core/limite_intentos.py
"""
Limitador de intentos en memoria (ventana deslizante), sin dependencias.

Pensado para el despliegue actual de UN solo proceso uvicorn (igual que el
barrido periódico). Con varios workers cada proceso llevaría su propia cuenta y el
límite efectivo se multiplicaría: en ese caso hay que moverlo a un almacén
compartido (p. ej. Redis).
"""

import threading
import time
from collections import defaultdict, deque


class LimitadorIntentos:
    def __init__(self, max_intentos: int, ventana_seg: int):
        self.max_intentos = max_intentos
        self.ventana_seg = ventana_seg
        self._eventos: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _vigentes(self, clave: str, ahora: float) -> deque[float]:
        cola = self._eventos[clave]
        while cola and cola[0] <= ahora - self.ventana_seg:
            cola.popleft()
        if not cola:
            del self._eventos[clave]  # no acumular claves viejas
            return deque()
        return cola

    def segundos_restantes(self, clave: str) -> int:
        """0 si la clave puede intentar; si no, cuántos segundos faltan."""
        ahora = time.monotonic()
        with self._lock:
            cola = self._vigentes(clave, ahora)
            if len(cola) < self.max_intentos:
                return 0
            return max(1, int(cola[0] + self.ventana_seg - ahora))

    def registrar(self, clave: str) -> None:
        with self._lock:
            self._eventos[clave].append(time.monotonic())

    def reiniciar(self, clave: str) -> None:
        with self._lock:
            self._eventos.pop(clave, None)
