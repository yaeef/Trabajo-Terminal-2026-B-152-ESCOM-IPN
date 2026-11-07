# backend/app/schemas/custodio.py
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, computed_field

from app.schemas.comunes import (
    MAX_NOMBRE_PERSONA,
    Apellido,
    TextoRecortado,
    sin_control,
    texto_acotado,
)


def _nombre(v: str) -> str:
    return sin_control(texto_acotado(v, "El nombre", 2, MAX_NOMBRE_PERSONA), "El nombre")


def _parentesco(v: str) -> str:
    return sin_control(texto_acotado(v, "El parentesco", 2, 50), "El parentesco")


NombreCustodio = Annotated[TextoRecortado, AfterValidator(_nombre)]
Parentesco = Annotated[TextoRecortado, AfterValidator(_parentesco)]


class CustodioCrearRequest(BaseModel):
    """
    CU-011: Registrar Nuevo Custodio.

    El Telegram del custodio no se recibe aquí: se vincula después de
    crearlo, con POST /custodios/{id}/telegram/link-code, y lo completa el
    propio custodio al mandar su código al bot (así se captura su chat_id
    real).
    """

    nombre: NombreCustodio
    paterno: Apellido = None
    materno: Apellido = None
    parentesco: Parentesco
    correo: EmailStr


class CustodioEditarRequest(BaseModel):
    """CU-012: Editar datos del Custodio. Todos los campos opcionales (PATCH)."""

    nombre: NombreCustodio | None = None
    paterno: Apellido = None
    materno: Apellido = None
    parentesco: Parentesco | None = None
    correo: EmailStr | None = None


class CustodioResponse(BaseModel):
    """CU-010: fila del directorio de custodios."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    paterno: str | None = None
    materno: str | None = None
    parentesco: str
    correo: EmailStr
    correo_verificado: bool
    telegram_verificado: bool
    created_at: datetime | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def nombre_completo(self) -> str:
        return " ".join(p for p in (self.nombre, self.paterno, self.materno) if p)


class EnlaceTelegramEnviadoResponse(BaseModel):
    """El deep link va SOLO al correo del custodio: si se le devolviera al
    propietario, podría vincular su propio Telegram como si fuera el del
    custodio y recibir sus avisos del DMS."""

    detail: str
    expira_en_segundos: int


class ConfirmarCanalCustodioRequest(BaseModel):
    """El custodio llega desde el link del correo, sin sesión activa."""

    token: str
