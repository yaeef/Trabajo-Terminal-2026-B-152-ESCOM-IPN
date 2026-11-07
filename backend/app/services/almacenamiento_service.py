# backend/app/services/almacenamiento_service.py
"""
Acceso a Azure Blob Storage (Azurite en dev) para los activos cifrados.

El backend NUNCA sube ni descarga los bytes: solo
  - crea el contenedor y configura CORS (una vez),
  - emite SAS de vida corta (escritura / lectura) para que el navegador
    hable directo con el blob,
  - comprueba tamaño / borra blobs.

Los archivos ya vienen cifrados desde el navegador (AES-256-GCM con la DEK
de la bóveda). Aquí es opaco.
"""

import logging
from contextlib import suppress
from datetime import timedelta

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import (
    BlobSasPermissions,
    BlobServiceClient,
    CorsRule,
    generate_blob_sas,
)

from app.core.config import settings
from app.core.tiempo import ahora

logger = logging.getLogger(__name__)

MINUTOS_SAS_ESCRITURA = 15
MINUTOS_SAS_LECTURA = 5

_cliente: BlobServiceClient | None = None
_listo = False


def _servicio() -> BlobServiceClient:
    global _cliente
    if _cliente is None:
        if not settings.AZURE_STORAGE_CONNECTION_STRING:
            raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING no configurada.")
        _cliente = BlobServiceClient.from_connection_string(
            settings.AZURE_STORAGE_CONNECTION_STRING
        )
    return _cliente


def asegurar_contenedor() -> None:
    """Crea el contenedor y fija CORS (idempotente, se ejecuta una vez)."""
    global _listo
    if _listo:
        return
    servicio = _servicio()
    try:
        servicio.create_container(settings.AZURE_ACTIVOS_CONTAINER)
    except ResourceExistsError:
        pass
    except Exception:
        logger.exception("No se pudo crear el contenedor de activos")
    # CORS para que el navegador pueda PUT/GET directo al blob.
    try:
        servicio.set_service_properties(
            cors=[
                CorsRule(
                    allowed_origins=["*"],
                    allowed_methods=["GET", "PUT", "OPTIONS", "HEAD"],
                    allowed_headers=["*"],
                    exposed_headers=["*"],
                    max_age_in_seconds=3600,
                )
            ]
        )
    except Exception:
        logger.exception("No se pudo configurar CORS de Blob Storage")
    _listo = True


def _url_publica(nombre_blob: str, sas: str) -> str:
    base = settings.AZURE_BLOB_PUBLIC_ENDPOINT.rstrip("/")
    return f"{base}/{settings.AZURE_ACTIVOS_CONTAINER}/{nombre_blob}?{sas}"


def _sas(nombre_blob: str, permiso: BlobSasPermissions, minutos: int) -> str:
    servicio = _servicio()
    assert servicio.account_name, "la cadena de conexión no trae AccountName"
    return generate_blob_sas(
        account_name=servicio.account_name,
        container_name=settings.AZURE_ACTIVOS_CONTAINER,
        blob_name=nombre_blob,
        account_key=servicio.credential.account_key,
        permission=permiso,
        start=ahora() - timedelta(minutes=2),  # margen de reloj
        expiry=ahora() + timedelta(minutes=minutos),
    )


def url_escritura(nombre_blob: str) -> str:
    asegurar_contenedor()
    permiso = BlobSasPermissions(write=True, create=True)
    return _url_publica(nombre_blob, _sas(nombre_blob, permiso, MINUTOS_SAS_ESCRITURA))


def url_lectura(nombre_blob: str) -> str:
    asegurar_contenedor()
    return _url_publica(
        nombre_blob, _sas(nombre_blob, BlobSasPermissions(read=True), MINUTOS_SAS_LECTURA)
    )


def tamano_blob(nombre_blob: str) -> int | None:
    """Tamaño del blob en bytes, o None si no existe."""
    try:
        propiedades = (
            _servicio()
            .get_blob_client(settings.AZURE_ACTIVOS_CONTAINER, nombre_blob)
            .get_blob_properties()
        )
        return propiedades.size
    except ResourceNotFoundError:
        return None


def borrar_blob(nombre_blob: str) -> None:
    with suppress(ResourceNotFoundError):
        _servicio().get_blob_client(settings.AZURE_ACTIVOS_CONTAINER, nombre_blob).delete_blob()


def borrar_prefijo(prefijo: str) -> int:
    """Borra todos los blobs bajo `prefijo` (p. ej. '<pid>/'). Devuelve cuántos."""
    contenedor = _servicio().get_container_client(settings.AZURE_ACTIVOS_CONTAINER)
    n = 0
    try:
        for b in contenedor.list_blobs(name_starts_with=prefijo):
            try:
                contenedor.delete_blob(b.name)
                n += 1
            except ResourceNotFoundError:
                pass
    except ResourceNotFoundError:
        pass
    return n
