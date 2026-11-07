# backend/app/schemas/usuario.py
import re
from datetime import date, datetime
from typing import Annotated, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    field_validator,
    model_validator,
)

from app.core.seguridad import LONGITUD_MAX_CONTRASENA
from app.models.usuario import EstadoDMS
from app.schemas.comunes import MAX_NOMBRE_PERSONA, Apellido, TextoRecortado, sin_control

REGLAS_CONTRASENA = (
    (r"[A-Z]", "La contraseña debe contener al menos una mayúscula."),
    (r"[a-z]", "La contraseña debe contener al menos una minúscula."),
    (r"[0-9]", "La contraseña debe contener al menos un número."),
    (r"[!@#$%^&*(),.?\":{}|<>]", "La contraseña debe contener al menos un carácter especial."),
)

# Valores fijos del protocolo de vida (deben coincidir con el CHECK de la
# tabla `propietario`, ver db/init/001_init_schema.sql).
PERIODICIDAD_PRUEBA_OPCIONES = (30, 45, 60)
PERIODICIDAD_GRACIA_OPCIONES = (7, 14, 21)


def _contrasena_robusta(v: str) -> str:
    # RN-001: Mínimo 12 caracteres, alfanumérico + símbolos
    if len(v) < 12:
        raise ValueError("La contraseña debe tener al menos 12 caracteres.")
    if len(v) > LONGITUD_MAX_CONTRASENA:
        raise ValueError(f"La contraseña no puede exceder {LONGITUD_MAX_CONTRASENA} caracteres.")
    for patron, mensaje in REGLAS_CONTRASENA:
        if not re.search(patron, v):
            raise ValueError(mensaje)
    return v


def _nombre_requerido(v: str) -> str:
    if not v:
        raise ValueError("El nombre no puede estar vacío.")
    if len(v) > MAX_NOMBRE_PERSONA:
        raise ValueError(f"El nombre no puede exceder {MAX_NOMBRE_PERSONA} caracteres.")
    return sin_control(v, "El nombre")


def _username(v: str) -> str:
    if not (3 <= len(v) <= 50):
        raise ValueError("El username debe tener entre 3 y 50 caracteres.")
    if not re.match(r"^[a-zA-Z0-9_.]+$", v):
        raise ValueError("El username solo puede contener letras, números, '_' y '.'.")
    return v


ContrasenaNueva = Annotated[str, AfterValidator(_contrasena_robusta)]
NombrePersona = Annotated[TextoRecortado, AfterValidator(_nombre_requerido)]


class RegistroRequest(BaseModel):
    """Alta de cuenta. El correo secundario y el Telegram no se reciben aquí:
    solo se vinculan por sus flujos verificados (ver autenticacion_service.registrar_usuario)."""

    username: Annotated[str, AfterValidator(_username)]
    nombre: NombrePersona
    materno: Apellido = None
    paterno: Apellido = None
    correo: EmailStr
    password: ContrasenaNueva


class SuscripcionActivaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    nombre: str
    fecha_inicio: date
    fecha_fin: date | None = None


class UsuarioResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    nombre: str
    materno: str | None = None
    paterno: str | None = None
    correo: EmailStr
    correo_sec: EmailStr | None = None
    id_telegram: str | None = None
    rol: str
    suscripcion_activa: SuscripcionActivaResponse | None = None
    # Cola de eliminación de cuenta (NULL si no hay solicitud pendiente).
    eliminacion_solicitada_en: datetime | None = None
    eliminacion_purga_en: datetime | None = None
    # Interruptor de Hombre Muerto (None si no es propietario). El frontend usa
    # esto para desviar el login a la pantalla de aviso cuando ya es "liberado".
    status_dms: EstadoDMS | None = None


class TokenAccesoResponse(BaseModel):
    """JWT de sesión devuelto por /login (no confundir con TokenRecuperacion)."""

    access_token: str
    token_type: str


class OlvideContrasenaRequest(BaseModel):
    correo: EmailStr


class ConfirmarRegistroRequest(BaseModel):
    token: str


class RestablecerContrasenaRequest(BaseModel):
    token: str
    nueva_password: ContrasenaNueva


class PerfilEditarRequest(BaseModel):
    """PATCH /users/me: solo datos de identidad; los canales tienen su propio flujo."""

    nombre: NombrePersona | None = None
    paterno: Apellido = None
    materno: Apellido = None


class CambiarContrasenaRequest(BaseModel):
    password_actual: str
    nueva_password: ContrasenaNueva
    confirmar_password: str

    @model_validator(mode="after")
    def _confirmacion_coincide(self) -> Self:
        if self.confirmar_password != self.nueva_password:
            raise ValueError("La confirmación no coincide con la nueva contraseña.")
        return self


class ProtocoloVidaRequest(BaseModel):
    """CU-015: umbral de inactividad y periodo de gracia del DMS."""

    periodicidad_prueba: int
    periodicidad_periodo_gracia: int

    @field_validator("periodicidad_prueba")
    @classmethod
    def _umbral_permitido(cls, v: int) -> int:
        if v not in PERIODICIDAD_PRUEBA_OPCIONES:
            raise ValueError(
                f"El umbral de inactividad debe ser uno de {PERIODICIDAD_PRUEBA_OPCIONES} días."
            )
        return v

    @field_validator("periodicidad_periodo_gracia")
    @classmethod
    def _gracia_permitida(cls, v: int) -> int:
        if v not in PERIODICIDAD_GRACIA_OPCIONES:
            raise ValueError(
                f"El periodo de gracia debe ser uno de {PERIODICIDAD_GRACIA_OPCIONES} días."
            )
        return v


class ProtocoloVidaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    periodicidad_prueba: int | None = None
    periodicidad_periodo_gracia: int | None = None
    ultima_prueba: datetime | None = None
    status_dms: EstadoDMS


class CheckinItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fecha_prueba: datetime
    metodo: str
    identificador: str | None = None
    ip_origen: str | None = None
    dias_extendidos: int


class HistorialCheckinsResponse(BaseModel):
    """Respuesta combinada: stats de las 3 tarjetas + tabla de logs, en una sola llamada."""

    inactividad_permitida: int | None = None
    ultima_senal: datetime | None = None
    estado_interruptor: EstadoDMS
    logs: list[CheckinItem]


class EliminarCuentaRequest(BaseModel):
    """Confirmación de contraseña obligatoria para una acción destructiva."""

    password: str


class EliminacionCuentaResponse(BaseModel):
    """Resultado de encolar la cuenta para eliminación."""

    detail: str
    purga_en: datetime


class CorreoSecundarioRequest(BaseModel):
    correo_nuevo: EmailStr


class ConfirmarCorreoSecundarioRequest(BaseModel):
    token: str


class CodigoTelegramResponse(BaseModel):
    deep_link: str
    expira_en_segundos: int
