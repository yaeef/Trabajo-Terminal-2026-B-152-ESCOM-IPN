# backend/app/api/routes/atestacion.py
"""
Endpoint PÚBLICO para que un custodio emita su atestación (vida / fallecimiento)
en el Interruptor de Hombre Muerto. Sin sesión: la autorización es el token de
un solo uso que llega en el enlace del correo (mismo patrón que
`confirmar-custodio`). Los custodios no tienen cuenta.
"""

from typing import Any

from fastapi import APIRouter, HTTPException, status

from app.api.dependencias import SesionBD
from app.schemas.dms import AtestacionContexto, AtestacionRequest, AtestacionResultado
from app.services import dms
from app.services.errores import ErrorDeDominio

router = APIRouter()


@router.get("/{token}", response_model=AtestacionContexto)
def leer_atestacion(token: str, db: SesionBD) -> dict[str, Any]:
    """Un enlace inválido se reporta como 404 (la página muestra "no encontrado")."""
    try:
        return dms.obtener_atestacion(db, token)
    except ErrorDeDominio as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.post("/{token}", response_model=AtestacionResultado)
def emitir_atestacion(token: str, datos: AtestacionRequest, db: SesionBD) -> dict[str, Any]:
    """Registra el voto (exige la x de un fragmento asignado) y evalúa el DMS en el acto."""
    return dms.registrar_atestacion(db, token, datos.sentido, datos.pid_boveda, datos.x_fragmento)
