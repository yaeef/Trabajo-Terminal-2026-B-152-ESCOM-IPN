# backend/app/schemas/activo.py
import re
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, field_validator

from app.schemas.comunes import TextoRecortado, Verificador, hex_de_longitud, texto_acotado

_PLANTILLA_RE = re.compile(r"^[a-z0-9_]{1,40}$")
MAX_BYTES_ARCHIVO = 5 * 1024**3  # 5 GiB: límite de un PUT single-shot de block blob
MAX_NOMBRE = 255
MAX_MIME = 120  # activos_digitales.mime es VARCHAR(120)


def _plantilla(v: str | None) -> str | None:
    if not v:
        return None
    v = v.lower()
    if not _PLANTILLA_RE.match(v):
        raise ValueError("Identificador de plantilla inválido.")
    return v


def _mime(v: str | None) -> str | None:
    if v and len(v) > MAX_MIME:
        raise ValueError(f"El tipo MIME no puede exceder {MAX_MIME} caracteres.")
    return v or None


def _sha256(v: str | None) -> str | None:
    return None if v is None else hex_de_longitud(v, 64, "sha256_plano")


class IniciarSubidaRequest(BaseModel):
    """CU-024, paso 1: el navegador pide un SAS de escritura."""

    passphrase_verifier: Verificador
    nombre: Annotated[
        TextoRecortado, AfterValidator(lambda v: texto_acotado(v, "El nombre", 1, MAX_NOMBRE))
    ]
    mime: Annotated[TextoRecortado | None, AfterValidator(_mime)] = None
    # Plantilla de credenciales; None = archivo subido por el usuario.
    plantilla: Annotated[TextoRecortado | None, AfterValidator(_plantilla)] = None
    tamano_bytes: int  # archivo en claro
    tamano_cifrado: int  # ciphertext (lo que cuenta para la cuota)
    # Nonce AES-GCM de 12 bytes.
    iv_hex: Annotated[str, AfterValidator(lambda v: hex_de_longitud(v, 24, "iv_hex"))]
    sha256_plano: Annotated[str | None, AfterValidator(_sha256)] = None

    @field_validator("tamano_bytes", "tamano_cifrado")
    @classmethod
    def _tamano_en_rango(cls, v: int) -> int:
        if v < 0 or v > MAX_BYTES_ARCHIVO:
            raise ValueError(f"Tamaño fuera de rango (máx. {MAX_BYTES_ARCHIVO} bytes por archivo).")
        return v


class SoloPassphraseRequest(BaseModel):
    """Cuerpo para confirmar / descargar / eliminar un activo."""

    passphrase_verifier: Verificador


class IniciarSubidaResponse(BaseModel):
    activo_id: int
    blob_name: str
    sas_url: str
    expira_en_segundos: int


class DescargaResponse(BaseModel):
    sas_url: str
    iv_hex: str
    nombre_original: str
    mime: str | None = None
    expira_en_segundos: int


class ActivoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre_original: str
    mime: str | None = None
    plantilla: str | None = None
    tamano_bytes: int
    tamano_cifrado: int
    estado: str
    created_at: datetime | None = None
