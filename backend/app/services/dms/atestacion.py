"""
Atestación pública de los custodios (sin sesión): la autorización es el
token de un solo uso del enlace, y el voto solo cuenta si además aportan un
fragmento válido con la coordenada x que tienen asignada.
"""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import seguridad
from app.core.tiempo import ahora
from app.models.boveda import Boveda, CompromisoVss, CustodioBoveda, EstadoBoveda
from app.models.dms_atestacion import DmsAtestacion, SentidoAtestacion
from app.models.usuario import Propietario
from app.services.dms import avisos, estados, maquina
from app.services.errores import DatoInvalido

logger = logging.getLogger("b152.dms")

# Mismo mensaje para ambos rechazos: a quien solo tiene el token no hay que
# decirle si falló la bóveda o la coordenada.
_ERROR_FRAGMENTO = "El fragmento no corresponde a tu asignación en esta bóveda."


def _fila(db: Session, token: str) -> DmsAtestacion:
    fila = db.scalar(
        select(DmsAtestacion).where(DmsAtestacion.hash_token == seguridad.hash_token(token))
    )
    if fila is None:
        raise DatoInvalido("Enlace de atestación inválido.")
    return fila


def _bovedas_candidatas(db: Session, id_custodio: int, id_propietario: int) -> list[dict[str, Any]]:
    """
    Bóvedas activas del propietario donde el custodio tiene una x asignada,
    con sus compromisos Feldman públicos: el navegador valida localmente
    cuál de sus fragmentos .sss corresponde (mismo mecanismo que el portal
    de recuperación real).
    """
    filas = db.execute(
        select(Boveda, CompromisoVss)
        .join(CustodioBoveda, CustodioBoveda.id_boveda == Boveda.id)
        .join(CompromisoVss, CompromisoVss.id_boveda == Boveda.id)
        .where(
            CustodioBoveda.id_custodio == id_custodio,
            Boveda.id_propietario == id_propietario,
            Boveda.estado == EstadoBoveda.activa,
        )
    ).all()
    return [
        {
            "pid": b.pid,
            "nombre": b.nombre,
            "commitments_hex": vss.commitments_hex,
            "x_coords": vss.x_coords,
        }
        for b, vss in filas
    ]


def obtener_atestacion(db: Session, token: str) -> dict[str, Any]:
    """Contexto para la página pública del custodio."""
    fila = _fila(db, token)
    prop = db.get(Propietario, fila.id_propietario)
    vigente = (
        prop is not None
        and prop.status_dms in estados.CON_VOTACION
        and fila.ronda == prop.dms_ronda
    )
    # Los compromisos VSS solo hacen falta mientras el voto siga pendiente
    # y la ronda abierta.
    bovedas = (
        _bovedas_candidatas(db, fila.id_custodio, fila.id_propietario)
        if vigente and fila.sentido is None
        else []
    )
    return {
        "propietario_nombre": avisos.nombre_propietario(prop.usuario) if prop else "el titular",
        "estado": prop.status_dms if prop else "desconocido",
        "vigente": vigente,
        "ya_voto": fila.sentido is not None,
        "sentido": fila.sentido.value if fila.sentido else None,
        "bovedas": bovedas,
    }


def registrar_atestacion(
    db: Session, token: str, sentido: str, pid_boveda: str, x_fragmento: int
) -> dict[str, Any]:
    """
    Registra el voto de un custodio y evalúa la transición de inmediato.

    El voto solo es válido si el custodio aporta la coordenada x de un
    fragmento que ya validó con Feldman VSS en su navegador (el servidor
    nunca ve `y`) Y esa x coincide con la que tiene asignada en
    `custodios_bovedas` para la bóveda indicada: así solo el custodio
    correcto, con su fragmento correcto, puede votar, no cualquiera con
    acceso al enlace.

    Nota de seguridad: la comparación es sobre un entero público (`x`), no
    una prueba criptográfica de que el cliente conoce `y` (misma limitación
    que el match informativo de la recuperación real). Se acepta por
    decisión de producto; una prueba de conocimiento cero queda fuera de alcance.
    """
    try:
        voto = SentidoAtestacion(sentido)
    except ValueError:
        raise DatoInvalido("Sentido inválido: usa 'vida' o 'fallecimiento'.") from None

    fila = _fila(db, token)
    prop = db.get(Propietario, fila.id_propietario)
    if prop is None:
        raise DatoInvalido("El titular ya no existe.")
    if prop.status_dms not in estados.CON_VOTACION:
        raise DatoInvalido("La votación no está abierta en este momento.")
    if fila.ronda != prop.dms_ronda:
        raise DatoInvalido("Esta ronda de votación ya cerró.")
    if fila.sentido is not None:
        raise DatoInvalido("Ya registraste tu respuesta para esta ronda.")

    boveda = db.scalar(
        select(Boveda).where(Boveda.pid == pid_boveda, Boveda.estado == EstadoBoveda.activa)
    )
    if boveda is None or boveda.id_propietario != fila.id_propietario:
        raise DatoInvalido(_ERROR_FRAGMENTO)
    asignada = db.scalar(
        select(CustodioBoveda.id_custodio).where(
            CustodioBoveda.id_boveda == boveda.id,
            CustodioBoveda.id_custodio == fila.id_custodio,
            CustodioBoveda.x_fragmento == x_fragmento,
        )
    )
    if asignada is None:
        raise DatoInvalido(_ERROR_FRAGMENTO)

    fila.sentido = voto
    fila.votado_en = ahora()
    fila.id_boveda = boveda.id
    fila.x_fragmento = x_fragmento

    # El voto ya es válido: si la evaluación falla, se revierte solo ella
    # (savepoint) y el voto se conserva para el siguiente barrido.
    cambio = None
    try:
        with db.begin_nested():
            cambio = maquina.evaluar(db, prop, ahora())
    except Exception:
        logger.exception("Fallo evaluando el DMS tras la atestación del propietario %s", prop.id)
    return {"registrado": True, "sentido": sentido, "transicion": cambio}
