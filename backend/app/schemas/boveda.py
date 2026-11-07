# backend/app/schemas/boveda.py
from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, field_validator, model_validator

from app.schemas.comunes import (
    HEX_RE,
    MAX_X,
    CoordenadaX,
    TextoRecortado,
    Verificador,
    params_kdf_acotados,
    salt_kdf_hex,
    texto_acotado,
)

# Tamaños del motor Shamir/Feldman (secp256k1), ver frontend/public/wasm/sss-api.js
LONGITUD_HEX_PUNTO = 33 * 2  # punto comprimido SEC1 en hex
MIN_K = 2  # RN-005: k nunca puede ser 1
MIN_N = 3  # RN-006: con mayoría simple, n=2 no admite ningún k válido
MAX_N = 255  # límite práctico (el reparto real son unos pocos custodios)
MAX_MENSAJE = 2000  # nota para custodios
_KDF_ALGOS = {"argon2id", "pbkdf2-sha256", "scrypt"}


def min_k_mayoria_simple(n: int) -> int:
    """RN-006: k debe representar mayoría simple de los n custodios (floor(n/2)+1)."""
    return n // 2 + 1


def _nombre_boveda(v: str) -> str:
    return texto_acotado(v, "El nombre de la bóveda", 2, 150)


def _categoria(v: str | None) -> str | None:
    if v and len(v) > 50:
        raise ValueError("La categoría no puede exceder 50 caracteres.")
    return v or None


def _mensaje(v: str | None) -> str | None:
    if v and len(v) > MAX_MENSAJE:
        raise ValueError(f"El mensaje para custodios no puede exceder {MAX_MENSAJE} caracteres.")
    return v or None


NombreBoveda = Annotated[TextoRecortado, AfterValidator(_nombre_boveda)]
Categoria = Annotated[TextoRecortado | None, AfterValidator(_categoria)]
MensajeCustodios = Annotated[TextoRecortado | None, AfterValidator(_mensaje)]


class EnvolturaKdf(BaseModel):
    """
    Cómo derivar la DEK AES-256 a partir de la pass-phrase de la bóveda.
    Nada de esto es secreto (salt y parámetros): el secreto es la pass-phrase,
    que jamás llega al servidor. El servidor solo lo almacena y lo devuelve
    para que cualquier dispositivo pueda re-derivar la misma DEK.
    """

    algo: str = "argon2id"
    salt: str
    params: dict[str, Any]

    @field_validator("algo")
    @classmethod
    def _algo_soportado(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in _KDF_ALGOS:
            raise ValueError(f"algo KDF no soportado; usa uno de {sorted(_KDF_ALGOS)}.")
        return v

    @field_validator("salt")
    @classmethod
    def _salt_hex(cls, v: str) -> str:
        return salt_kdf_hex(v, "salt KDF")

    @field_validator("params")
    @classmethod
    def _params_robustos(cls, v: dict[str, Any]) -> dict[str, Any]:
        params_kdf_acotados(v, "params KDF")
        # Piso de robustez para Argon2id (el cliente decide el resto).
        if {"t", "m"} <= set(v):
            try:
                t, m = int(v["t"]), int(v["m"])
            except (TypeError, ValueError):
                raise ValueError("Los parámetros t y m de Argon2id deben ser enteros.") from None
            if t < 2 or m < 19456:
                raise ValueError("Parámetros Argon2id demasiado débiles (mín. t=2, m=19456 KiB).")
        return v


class BovedaCrearRequest(BaseModel):
    """
    CU-020, Paso 1: metadatos + envoltura de la pass-phrase.

    La pass-phrase se elige/genera en el navegador; de ella se deriva la DEK
    AES-256 (que además es el secreto que luego se fragmenta). El cliente
    manda SOLO la forma de re-derivarla (kdf) y un verificador
    (passphrase_verifier = hash calculado sobre la DEK).
    """

    nombre: NombreBoveda
    categoria: Categoria = None
    mensaje_custodios: MensajeCustodios = None
    kdf: EnvolturaKdf
    passphrase_verifier: Verificador


class BovedaEditarRequest(BaseModel):
    """
    CU-023: renombrar / recategorizar / editar nota. Requiere la pass-phrase
    de la bóveda (verificador), igual que cualquier operación sobre ella
    salvo el borrado. n/k no se tocan aquí (van por PUT /vss).
    """

    passphrase_verifier: Verificador
    nombre: NombreBoveda | None = None
    categoria: Categoria = None
    mensaje_custodios: MensajeCustodios = None


class BovedaEliminarRequest(BaseModel):
    """El modal de borrado pide la contraseña de la CUENTA (no la pass-phrase)."""

    password: str


class VerificarPassphraseRequest(BaseModel):
    """CU-027 'Confirmar Llave maestra': guardia previa a operaciones críticas."""

    passphrase_verifier: Verificador


class BovedaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    pid: str
    nombre: str
    categoria: str | None = None
    mensaje_custodios: str | None = None
    kdf: EnvolturaKdf
    umbral_k: int | None = None
    total_fragmentos_n: int | None = None
    estado: str
    # nº de custodios ya vinculados. El frontend deriva el badge:
    #   estado == 'activa' y custodios_vinculados >= total_fragmentos_n -> "PROTEGIDA"
    #   en otro caso, con VSS ya cargado                                -> "INCOMPLETA"
    custodios_vinculados: int = 0
    # Uso de almacenamiento del PROPIETARIO (suma de todas sus bóvedas) vs cuota
    # de su plan. Igual en todas sus bóvedas; alimenta el indicador de espacio.
    usado_bytes: int = 0
    cuota_bytes: int = 0
    created_at: datetime | None = None


class CompromisosVssRequest(BaseModel):
    """
    CU-021, Paso 2 (cola): el navegador ya ejecutó sss.split(llave, n, k,
    {feldman:true}) y sube SOLO la parte pública.

    - commitments_hex: los `commitments` (Uint8Array de k*33 bytes) en hex.
    - x_coords: los `shares[i].id` del reparto (coordenadas x, no secretas).
    NUNCA se envían los valores `y` de los shares.
    """

    passphrase_verifier: Verificador
    n: int
    k: int
    commitments_hex: str
    x_coords: list[int]

    @field_validator("n")
    @classmethod
    def _n_en_rango(cls, v: int) -> int:
        if not (MIN_N <= v <= MAX_N):
            raise ValueError(f"n (total de fragmentos) debe estar entre {MIN_N} y {MAX_N}.")
        return v

    @field_validator("k")
    @classmethod
    def _k_minimo(cls, v: int) -> int:
        if v < MIN_K:
            raise ValueError("El umbral k no puede ser menor que 2 (RN-005).")
        return v

    @field_validator("commitments_hex")
    @classmethod
    def _puntos_comprimidos(cls, v: str) -> str:
        v = v.strip().lower()
        if not HEX_RE.match(v):
            raise ValueError("commitments_hex debe ser hexadecimal.")
        if len(v) % LONGITUD_HEX_PUNTO != 0:
            raise ValueError("commitments_hex no es múltiplo de 33 bytes (punto SEC1).")
        # Cada punto comprimido SEC1 empieza en 0x02 o 0x03 (paridad de Y).
        for j in range(len(v) // LONGITUD_HEX_PUNTO):
            prefijo = v[j * LONGITUD_HEX_PUNTO : j * LONGITUD_HEX_PUNTO + 2]
            if prefijo not in ("02", "03"):
                raise ValueError(
                    f"El compromiso #{j} no es un punto comprimido válido (prefijo {prefijo})."
                )
        return v

    @field_validator("x_coords")
    @classmethod
    def _coordenadas_validas(cls, v: list[int]) -> list[int]:
        if any(not (1 <= x <= MAX_X) for x in v):
            raise ValueError(f"Cada coordenada x debe estar entre 1 y {MAX_X}.")
        if len(set(v)) != len(v):
            raise ValueError("Las coordenadas x no pueden repetirse.")
        return v

    @model_validator(mode="after")
    def _coherencia_n_k(self) -> Self:
        # RN-005: k < n; RN-006: k representa mayoría simple.
        if self.k >= self.n:
            raise ValueError("El umbral k debe ser menor que n (RN-005).")
        minimo = min_k_mayoria_simple(self.n)
        if self.k < minimo:
            raise ValueError(
                f"El umbral k debe representar mayoría simple: para n={self.n}, k debe ser al menos {minimo} (RN-006)."
            )
        puntos = len(self.commitments_hex) // LONGITUD_HEX_PUNTO
        if puntos != self.k:
            raise ValueError(f"commitments_hex trae {puntos} puntos pero k={self.k}.")
        if len(self.x_coords) != self.n:
            raise ValueError(f"x_coords debe traer exactamente n={self.n} coordenadas.")
        return self


class CompromisosVssResponse(BaseModel):
    n: int
    k: int
    commitments_hex: str
    x_coords: list[int]


class AsignacionRequest(BaseModel):
    """CU-022, Paso 3: asignar a un custodio la coordenada x de su fragmento."""

    id_custodio: int
    x_fragmento: CoordenadaX


class AsignacionesRequest(BaseModel):
    """
    Paso 3 del wizard: confirma de una sola vez el conjunto de custodios
    asignados. Reemplaza por completo las vinculaciones previas de la
    bóveda (operación atómica). El frontend empareja cada custodio
    seleccionado con una de las coordenadas x del reparto.
    """

    passphrase_verifier: Verificador
    asignaciones: list[AsignacionRequest]

    @field_validator("asignaciones")
    @classmethod
    def _sin_repetidos(cls, v: list[AsignacionRequest]) -> list[AsignacionRequest]:
        ids = [a.id_custodio for a in v]
        xs = [a.x_fragmento for a in v]
        if len(set(ids)) != len(ids):
            raise ValueError("Hay un custodio repetido en la lista.")
        if len(set(xs)) != len(xs):
            raise ValueError("Hay una coordenada x repetida en la lista.")
        return v


class AsignacionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id_custodio: int
    nombre: str
    correo: str
    x_fragmento: int
    created_at: datetime | None = None
