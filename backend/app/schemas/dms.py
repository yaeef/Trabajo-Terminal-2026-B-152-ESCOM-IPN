# backend/app/schemas/dms.py
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel

from app.schemas.comunes import CoordenadaX, TextoRecortado, texto_acotado

SentidoVoto = Literal["vida", "fallecimiento"]


class AtestacionBovedaCandidata(BaseModel):
    """
    Una bóveda activa del propietario donde este custodio tiene un fragmento
    asignado, con sus compromisos Feldman públicos — para que el navegador
    valide localmente cuál de sus fragmentos .sss corresponde (igual que en
    el portal de recuperación real).
    """

    pid: str
    nombre: str
    commitments_hex: str
    x_coords: list[int]


class AtestacionContexto(BaseModel):
    """Lo que ve la página pública del custodio al abrir su enlace."""

    propietario_nombre: str
    estado: str
    vigente: bool  # la ronda sigue abierta y aceptando votos
    ya_voto: bool
    sentido: SentidoVoto | None = None
    # Vacío si ya votó o la ronda no está vigente (no hace falta exponer VSS).
    bovedas: list[AtestacionBovedaCandidata] = []


class AtestacionRequest(BaseModel):
    sentido: SentidoVoto
    # El voto solo es válido si viene acompañado de un fragmento verificado
    # localmente (Feldman VSS) cuya x coincida con la asignada al custodio.
    pid_boveda: Annotated[
        TextoRecortado, AfterValidator(lambda v: texto_acotado(v, "pid_boveda", 1, 22))
    ]
    x_fragmento: CoordenadaX


class AtestacionResultado(BaseModel):
    registrado: bool
    sentido: SentidoVoto
    transicion: str | None = None  # transición del DMS disparada por este voto, si hubo


# --------------------------------------------------------------------------
# Resumen post-liberación: lo que ve el propietario al hacer login cuando su
# patrimonio ya se liberó (en vez del dashboard normal).
# --------------------------------------------------------------------------
class LiberacionVotoItem(BaseModel):
    custodio_nombre: str
    sentido: SentidoVoto | None = None  # None = no alcanzó a votar en esa ronda
    votado_en: datetime | None = None


class LiberacionRondaResumen(BaseModel):
    ronda: int
    votos: list[LiberacionVotoItem]


MotivoLiberacion = Literal["fallecimiento_confirmado", "limite_reconfirmaciones", "tiempo_agotado"]


class LiberacionResumenResponse(BaseModel):
    liberado: bool
    liberado_en: datetime | None = None
    motivo: MotivoLiberacion | None = None
    motivo_detalle: str = ""
    alerta_en: datetime | None = None
    gracia_en: datetime | None = None
    quorum: int | None = None
    total_custodios: int = 0
    reconfirmaciones: int = 0
    max_reconfirmaciones: int = 0
    rondas: list[LiberacionRondaResumen] = []
