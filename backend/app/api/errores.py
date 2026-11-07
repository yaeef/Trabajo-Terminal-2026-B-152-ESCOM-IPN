# backend/app/api/errores.py
"""
Traducción única de errores de dominio (services/errores.py) a respuestas
HTTP. Las rutas no atrapan nada: el error sube, la unidad de trabajo
revierte la transacción y este manejador responde `{"detail": mensaje}`.
"""

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.services.errores import (
    Conflicto,
    DatoInvalido,
    ErrorDeDominio,
    ErrorExterno,
    NoEncontrado,
    Prohibido,
    ServicioNoDisponible,
)

_CODIGOS: dict[type[ErrorDeDominio], int] = {
    DatoInvalido: status.HTTP_400_BAD_REQUEST,
    NoEncontrado: status.HTTP_404_NOT_FOUND,
    Conflicto: status.HTTP_409_CONFLICT,
    Prohibido: status.HTTP_403_FORBIDDEN,
    ServicioNoDisponible: status.HTTP_503_SERVICE_UNAVAILABLE,
    ErrorExterno: status.HTTP_502_BAD_GATEWAY,
}


def codigo_http(error: ErrorDeDominio) -> int:
    for tipo in type(error).__mro__:
        if tipo in _CODIGOS:
            return _CODIGOS[tipo]
    return status.HTTP_400_BAD_REQUEST


async def _responder(_request: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, ErrorDeDominio)
    return JSONResponse(status_code=codigo_http(error), content={"detail": str(error)})


def registrar_manejadores(app: FastAPI) -> None:
    app.add_exception_handler(ErrorDeDominio, _responder)
