# backend/app/api/routes/recuperacion.py
"""
CU-029 a CU-035 — Portal público de recuperación. Sin autenticación: los
custodios no tienen cuenta en el sistema, la "credencial" es conocer el PID
y aportar un fragmento válido — verificado con Feldman VSS en su propio
navegador antes de que cualquier cosa llegue aquí.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencias import SesionBD
from app.models.activo import ActivoDigital
from app.models.boveda import Boveda
from app.schemas.activo import ActivoResponse, DescargaResponse
from app.schemas.recuperacion import (
    BovedaRecuperacionResponse,
    CrearSesionRequest,
    DepositarFragmentoRequest,
    FragmentoDepositadoResponse,
    SesionEstadoResponse,
)
from app.services import recuperacion_service

router = APIRouter()

_NO_ENCONTRADA = "No se encontró ninguna bóveda en recuperación con ese identificador."


def _boveda_o_404(db: Session, pid: str) -> Boveda:
    boveda = recuperacion_service.buscar_boveda(db, pid)
    if boveda is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NO_ENCONTRADA)
    return boveda


@router.get("/bovedas/{pid}", response_model=BovedaRecuperacionResponse)
def buscar_boveda(pid: str, db: SesionBD) -> BovedaRecuperacionResponse:
    """CU-029: localiza una bóveda en recuperación por su PID (404 si no califica)."""
    boveda = _boveda_o_404(db, pid)
    return recuperacion_service.a_respuesta(db, boveda)


@router.get("/bovedas/{pid}/sesion", response_model=SesionEstadoResponse)
def leer_sesion(pid: str, db: SesionBD) -> SesionEstadoResponse:
    """Estado de la sesión vigente (`existe=False` si no hay ninguna activa)."""
    boveda = _boveda_o_404(db, pid)
    return recuperacion_service.estado_sesion(db, boveda)


@router.post(
    "/bovedas/{pid}/sesion",
    response_model=SesionEstadoResponse,
    status_code=status.HTTP_201_CREATED,
)
def crear_sesion(pid: str, datos: CrearSesionRequest, db: SesionBD) -> SesionEstadoResponse:
    """CU-030/031: el BP funda la sesión con su fragmento y su llave pública de sesión."""
    boveda = _boveda_o_404(db, pid)
    recuperacion_service.crear_sesion(db, boveda, datos)
    return recuperacion_service.estado_sesion(db, boveda)


@router.post("/bovedas/{pid}/sesion/reconstruido", response_model=SesionEstadoResponse)
def marcar_reconstruido(pid: str, db: SesionBD) -> SesionEstadoResponse:
    """El navegador del BP reporta que ya reconstruyó la DEK — informativo
    para los custodios, no lo verifica el servidor."""
    boveda = _boveda_o_404(db, pid)
    return recuperacion_service.marcar_reconstruido(db, boveda)


@router.post(
    "/bovedas/{pid}/sesion/fragmentos",
    response_model=FragmentoDepositadoResponse,
    status_code=status.HTTP_201_CREATED,
)
def depositar_fragmento(
    pid: str, datos: DepositarFragmentoRequest, db: SesionBD
) -> FragmentoDepositadoResponse:
    """CU-032: un custodio deposita su fragmento cifrado hacia la llave del BP."""
    boveda = _boveda_o_404(db, pid)
    deposito = recuperacion_service.depositar_fragmento(db, boveda, datos)
    return recuperacion_service.respuesta_deposito(db, deposito)


@router.get("/bovedas/{pid}/activos", response_model=list[ActivoResponse])
def listar_activos(pid: str, db: SesionBD) -> list[ActivoDigital]:
    """CU-034: metadatos en claro (el contenido sigue cifrado con la DEK)."""
    boveda = _boveda_o_404(db, pid)
    return recuperacion_service.listar_activos(db, boveda)


@router.post("/bovedas/{pid}/activos/{id_activo}/descarga", response_model=DescargaResponse)
def preparar_descarga(pid: str, id_activo: int, db: SesionBD) -> dict[str, Any]:
    """CU-035: SAS de lectura + iv para que el navegador baje y descifre con la DEK reconstruida."""
    boveda = _boveda_o_404(db, pid)
    return recuperacion_service.preparar_descarga_activo(db, boveda, id_activo)
