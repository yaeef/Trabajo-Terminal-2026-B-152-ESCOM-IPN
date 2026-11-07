# backend/app/schemas/recuperacion.py
"""
CU-029 a CU-035 — Portal público de recuperación: localización de bóveda por
PID, y la sesión efímera (Beneficiario Principal + custodios) para juntar el
quórum de fragmentos y reconstruir la DEK 100% en el navegador.

ZERO-KNOWLEDGE: nada aquí acepta ni devuelve un fragmento (x,y) en claro.
`ciphertext_hex` es siempre AES-256-GCM(y) con el secreto ECDH(epk, llave
pública de sesión del BP) — el servidor solo lo relé, nunca lo descifra.
"""

from datetime import datetime
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, ConfigDict, field_validator

from app.schemas.comunes import (
    CoordenadaX,
    TextoRecortado,
    hex_de_longitud,
    params_kdf_acotados,
    salt_kdf_hex,
    texto_acotado,
)

LONGITUD_HEX_LLAVE_X25519 = 32 * 2  # llave pública/efímera cruda, 32 B
LONGITUD_HEX_IV = 12 * 2  # nonce AES-GCM, 12 B
# y (32 B) + tag GCM (16 B) = 48 B: siempre el mismo tamaño porque el
# plaintext (un escalar de 32 B) nunca cambia de longitud.
LONGITUD_HEX_CIFRADO = 48 * 2
MAX_NOMBRE = 150
MAX_VINCULO = 50

LlaveX25519 = Annotated[
    str, AfterValidator(lambda v: hex_de_longitud(v, LONGITUD_HEX_LLAVE_X25519, "La llave"))
]
IvHex = Annotated[str, AfterValidator(lambda v: hex_de_longitud(v, LONGITUD_HEX_IV, "iv_hex"))]
CiphertextHex = Annotated[
    str, AfterValidator(lambda v: hex_de_longitud(v, LONGITUD_HEX_CIFRADO, "ciphertext_hex"))
]
NombreDeclarado = Annotated[
    TextoRecortado, AfterValidator(lambda v: texto_acotado(v, "El nombre", 1, MAX_NOMBRE))
]
VinculoDeclarado = Annotated[
    TextoRecortado, AfterValidator(lambda v: texto_acotado(v, "El vínculo", 1, MAX_VINCULO))
]


class BovedaRecuperacionResponse(BaseModel):
    """
    Lo mínimo que ve quien localiza una bóveda por su PID (sin autenticarse
    todavía): confirma que existe y está en recuperación, da el contexto para
    el siguiente paso, y los compromisos Feldman públicos para que el
    navegador valide localmente cualquier fragmento antes de cifrarlo.
    """

    pid: str
    nombre: str
    categoria: str | None = None
    mensaje_custodios: str | None = None
    umbral_k: int | None = None
    total_fragmentos_n: int | None = None
    recuperacion_iniciada_en: datetime | None = None
    ventana_expira_en: datetime | None = None
    commitments_hex: str | None = None
    x_coords: list[int] | None = None


class DepositoBase(BaseModel):
    x_fragmento: CoordenadaX
    epk_hex: LlaveX25519
    iv_hex: IvHex
    ciphertext_hex: CiphertextHex
    nombre_declarado: NombreDeclarado
    vinculo_declarado: VinculoDeclarado


class CrearSesionRequest(DepositoBase):
    """
    El fragmento del fundador (BP) + la llave pública de la sesión que acaba
    de generar/derivar. Se crea la sesión y su primer depósito (el propio)
    en una sola operación atómica.
    """

    bp_public_key: LlaveX25519
    bp_kdf_salt: str
    bp_kdf_params: dict[str, Any]

    @field_validator("bp_kdf_salt")
    @classmethod
    def _salt_hex(cls, v: str) -> str:
        return salt_kdf_hex(v, "bp_kdf_salt")

    @field_validator("bp_kdf_params")
    @classmethod
    def _params_acotados(cls, v: dict[str, Any]) -> dict[str, Any]:
        return params_kdf_acotados(v, "bp_kdf_params")


class DepositarFragmentoRequest(DepositoBase):
    """
    Un custodio (no fundador) se une a la sesión activa vigente.

    `bp_public_key` es la llave del Beneficiario Principal que el custodio
    vio y aceptó (y con la que cifró su fragmento): si entretanto esa sesión
    expiró y otra la reemplazó, el depósito se rechaza en vez de caer en una
    sesión que el custodio nunca eligió.
    """

    bp_public_key: LlaveX25519


class FragmentoDepositadoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    x_fragmento: int
    epk_hex: str
    iv_hex: str
    ciphertext_hex: str
    nombre_declarado: str
    vinculo_declarado: str
    depositado_en: datetime
    # Nombre del custodio al que el propietario asignó esta x en su
    # directorio. Informativo: permite contrastarlo con `nombre_declarado`,
    # que escribe libremente quien deposita. None si esa x no estaba
    # asignada a nadie o el custodio ya no existe.
    custodio_asignado: str | None = None


class SesionEstadoResponse(BaseModel):
    """
    Estado completo de la sesión vigente de una bóveda. Incluye los
    ciphertexts porque no hay forma de que el servidor sepa quién es
    realmente el BP (nunca vio su pass-phrase) — la confidencialidad la da
    el cifrado, no el control de acceso: quien no tenga la llave privada del
    BP no puede hacer nada útil con estos bytes.
    """

    existe: bool
    estado: str | None = None
    creada_en: datetime | None = None
    expira_en: datetime | None = None
    # Coordenada x del fragmento fundador — no es secreta (ya es pública
    # dentro del reparto). Permite al frontend reconocer "este fragmento que
    # acaban de subir es el del BP" sin pedirle que se auto-identifique.
    x_fundador: int | None = None
    # Reporte informativo (no verificado por el servidor) de cuándo el BP
    # reconstruyó la DEK con éxito por primera vez en esta sesión.
    reconstruido_en: datetime | None = None
    bp_public_key: str | None = None
    bp_kdf_algo: str | None = None
    bp_kdf_salt: str | None = None
    bp_kdf_params: dict[str, Any] | None = None
    umbral_k: int | None = None
    total_fragmentos_n: int | None = None
    depositos: list[FragmentoDepositadoResponse] = []
