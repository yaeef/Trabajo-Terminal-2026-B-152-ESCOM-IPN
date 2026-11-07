"""
Interruptor de Hombre Muerto (DMS).

    estados.py    estados, eventos y tabla de transiciones (la máquina)
    maquina.py    disparar eventos, acciones de entrada, evaluación y barrido
    roster.py     roster de custodios, quórum y condición de "armado"
    votos.py      rondas de votación: emisión de enlaces y conteo
    avisos.py     avisos al propietario y a los custodios (outbox)
    atestacion.py página pública de voto de los custodios
    protocolo.py  parámetros del protocolo de vida y señales de vida
    resumen.py    resumen post-liberación para el propietario
    ventana.py    Máquina 2: ventana W de recuperación de cada bóveda
"""

from app.services.dms.atestacion import obtener_atestacion, registrar_atestacion
from app.services.dms.estados import (
    CON_VOTACION,
    EN_CURSO,
    EVALUABLES,
    TRANSICIONES,
    Evento,
    TransicionInvalida,
    siguiente,
)
from app.services.dms.maquina import disparar, evaluar, extender_plazo, procesar_dms, recordar_ahora
from app.services.dms.protocolo import (
    actualizar_protocolo_vida,
    anonimizar_bitacora,
    historial_checkins,
    registrar_prueba_de_vida,
)
from app.services.dms.resumen import resumen_liberacion
from app.services.dms.ventana import procesar_ventana_recuperacion

__all__ = [
    "CON_VOTACION",
    "EN_CURSO",
    "EVALUABLES",
    "TRANSICIONES",
    "Evento",
    "TransicionInvalida",
    "actualizar_protocolo_vida",
    "anonimizar_bitacora",
    "disparar",
    "evaluar",
    "extender_plazo",
    "historial_checkins",
    "obtener_atestacion",
    "procesar_dms",
    "procesar_ventana_recuperacion",
    "recordar_ahora",
    "registrar_atestacion",
    "registrar_prueba_de_vida",
    "resumen_liberacion",
    "siguiente",
]
