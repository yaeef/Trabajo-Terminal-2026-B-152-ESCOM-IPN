# backend/app/main.py
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models as _modelos  # noqa: F401  (registra todos los modelos ORM)
from app.api import errores
from app.api.routes import (
    activos,
    admin,
    atestacion,
    autenticacion,
    bovedas,
    canales,
    cuenta,
    custodios,
    dms,
    recuperacion,
    suscripciones,
    telegram_webhook,
)
from app.core.config import settings
from app.services import tareas_periodicas


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Hilos daemon: entrega de notificaciones y barrido periódico (cola de
    # eliminación, DMS, ventana de recuperación); ver services/tareas_periodicas.py.
    if settings.SCHEDULER_ENABLED:
        tareas_periodicas.iniciar()
        logging.getLogger("uvicorn.error").info("Jobs en segundo plano iniciados.")
    yield


app = FastAPI(
    title="TT2 API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.ENABLE_DOCS else None,
    redoc_url="/redoc" if settings.ENABLE_DOCS else None,
    openapi_url="/openapi.json" if settings.ENABLE_DOCS else None,
)

errores.registrar_manejadores(app)

# La sesión viaja como `Authorization: Bearer`, nunca en cookies: no hace
# falta allow_credentials (con "*" + credenciales, Starlette reflejaba
# cualquier Origin como permitido para peticiones con credenciales).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(autenticacion.router, prefix="/api/v1/auth", tags=["Autenticación"])
app.include_router(cuenta.router, prefix="/api/v1/users", tags=["Perfil de Usuario"])
app.include_router(dms.router, prefix="/api/v1/propietario", tags=["Protocolo de Vida"])
app.include_router(canales.router, prefix="/api/v1/canales", tags=["Canales de Comunicación"])
app.include_router(custodios.router, prefix="/api/v1/custodios", tags=["Custodios"])
app.include_router(bovedas.router, prefix="/api/v1/bovedas", tags=["Bóvedas"])
app.include_router(activos.router, prefix="/api/v1/bovedas", tags=["Activos digitales"])
app.include_router(suscripciones.router, prefix="/api/v1/suscripciones", tags=["Suscripción"])
app.include_router(
    atestacion.router, prefix="/api/v1/atestacion", tags=["Atestación de custodios (DMS)"]
)
app.include_router(recuperacion.router, prefix="/api/v1/recuperacion", tags=["Recuperación"])
app.include_router(telegram_webhook.router, prefix="/api/v1/telegram", tags=["Telegram Webhook"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["Admin"])


@app.get("/health")
def salud() -> dict[str, str]:
    return {"status": "ok", "service": "TT API"}
