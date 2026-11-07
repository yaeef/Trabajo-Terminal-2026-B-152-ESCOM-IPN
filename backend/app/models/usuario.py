# backend/app/models/usuario.py
import enum
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import TYPE_CHECKING

from sqlalchemy import JSON, TIMESTAMP, DateTime, Enum, ForeignKey, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.core.tiempo import hoy
from app.db.sesion import Base

if TYPE_CHECKING:
    from app.models.prueba_vida_log import PruebaVidaLog
    from app.models.suscripcion import PropietarioSuscripcion
    from app.models.token_recuperacion import TokenRecuperacion


class RolUsuario(enum.StrEnum):
    propietario = "propietario"
    admin = "admin"


class EstadoDMS(enum.StrEnum):
    """Estado del Interruptor de Hombre Muerto (Máquina 1). Las transiciones
    permitidas están en services/dms/estados.py."""

    activo = "activo"
    alerta = "alerta"
    gracia = "gracia"
    gracia_reduccion = "gracia_reduccion"
    liberado = "liberado"
    pausado_eliminacion = "pausado_eliminacion"
    eliminado = "eliminado"


class Usuario(Base):
    """Cuenta con inicio de sesión: propietario (con su especialización
    `Propietario`) o admin, según `rol`. Los custodios no son usuarios."""

    __tablename__ = "usuario"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    nombre: Mapped[str] = mapped_column(String(100))
    materno: Mapped[str | None] = mapped_column(String(100))
    paterno: Mapped[str | None] = mapped_column(String(100))
    correo: Mapped[str] = mapped_column(String(100), unique=True)
    # Una cuenta recién registrada no puede iniciar sesión hasta confirmar su
    # correo con el enlace que se le envía (VerificacionCorreoRegistro).
    correo_verificado: Mapped[bool] = mapped_column(default=False)
    correo_sec: Mapped[str | None] = mapped_column(String(100))
    hash_pass: Mapped[str] = mapped_column(String(255))
    id_telegram: Mapped[str | None] = mapped_column(String(50))
    rol: Mapped[RolUsuario] = mapped_column(Enum(RolUsuario), default=RolUsuario.propietario)
    created_at: Mapped[datetime | None] = mapped_column(TIMESTAMP, server_default=func.now())

    propietario: Mapped["Propietario | None"] = relationship(
        back_populates="usuario", cascade="all, delete-orphan"
    )
    tokens_recuperacion: Mapped[list["TokenRecuperacion"]] = relationship(
        back_populates="usuario", cascade="all, delete-orphan"
    )

    @property
    def suscripcion_activa(self) -> SimpleNamespace | None:
        """Fila de propietario_suscripcion que cubre hoy (mismo criterio que
        `cuota.suscripcion_activa`) expuesta como objeto plano para
        `UsuarioResponse`. None si el usuario no es propietario (admin). Un
        propietario siempre tiene una; si faltara, es un bug (ValueError -> 500)."""
        if self.propietario is None:
            return None
        dia = hoy()
        activas = [s for s in self.propietario.suscripciones if s.vigente_en(dia)]
        vigente = max(activas, key=lambda s: s.fecha_inicio)
        return SimpleNamespace(
            nombre=vigente.suscripcion.nombre,
            fecha_inicio=vigente.fecha_inicio,
            fecha_fin=vigente.fecha_fin,
        )

    @property
    def eliminacion_solicitada_en(self) -> datetime | None:
        """Cuándo se pidió eliminar la cuenta (None si no hay solicitud)."""
        return self.propietario.eliminacion_solicitada_en if self.propietario else None

    @property
    def status_dms(self) -> EstadoDMS | None:
        """Estado del Interruptor de Hombre Muerto (None si no es propietario)."""
        return self.propietario.status_dms if self.propietario else None

    @property
    def eliminacion_purga_en(self) -> datetime | None:
        """Fecha en que el job purgará la cuenta si no se cancela."""
        pedida = self.eliminacion_solicitada_en
        if pedida is None:
            return None
        return pedida + timedelta(days=settings.ACCOUNT_DELETION_GRACE_DAYS)


class Propietario(Base):
    """
    Especialización 1:1 de Usuario. El id es a la vez PK y FK a usuario.id,
    así se evita duplicar identidad (patrón de herencia en modelo relacional).
    """

    __tablename__ = "propietario"

    id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), primary_key=True)
    # VARCHAR(50) en la BD (no ENUM nativo): el Enum de SQLAlchemy solo valida
    # y convierte al leer/escribir.
    status_dms: Mapped[EstadoDMS] = mapped_column(
        Enum(EstadoDMS, native_enum=False, length=50, validate_strings=True),
        default=EstadoDMS.activo,
    )
    # Cola de eliminación de cuenta: NULL = normal; con fecha = "bloqueada",
    # un job la purga al cumplirse ACCOUNT_DELETION_GRACE_DAYS.
    eliminacion_solicitada_en: Mapped[datetime | None] = mapped_column(DateTime)
    eliminacion_recordatorio_enviado: Mapped[bool] = mapped_column(default=False)
    ultima_prueba: Mapped[datetime | None] = mapped_column(DateTime)
    # Interruptor de Hombre Muerto: por defecto 60 días de inactividad + 7 de gracia.
    # periodicidad_prueba ∈ {30, 45, 60}; periodicidad_periodo_gracia ∈ {7, 14, 21}.
    periodicidad_prueba: Mapped[int | None] = mapped_column(default=60)
    periodicidad_periodo_gracia: Mapped[int | None] = mapped_column(default=7)

    # --- Interruptor de Hombre Muerto (Máquina 1) ---
    dms_alerta_en: Mapped[datetime | None] = mapped_column(DateTime)
    dms_gracia_en: Mapped[datetime | None] = mapped_column(DateTime)
    dms_reduccion_hasta: Mapped[datetime | None] = mapped_column(DateTime)
    dms_liberado_en: Mapped[datetime | None] = mapped_column(DateTime)
    dms_reconfirmaciones: Mapped[int] = mapped_column(SmallInteger, default=0)
    # Ids de los custodios del episodio y su quórum k = floor(Nc/2)+1,
    # congelados al entrar en 'alerta'.
    dms_roster_ronda: Mapped[list[int] | None] = mapped_column(JSON)
    dms_quorum: Mapped[int | None] = mapped_column(SmallInteger)
    dms_ronda: Mapped[int] = mapped_column(SmallInteger, default=0)
    dms_ultimo_aviso: Mapped[datetime | None] = mapped_column(DateTime)

    usuario: Mapped[Usuario] = relationship(back_populates="propietario")
    suscripciones: Mapped[list["PropietarioSuscripcion"]] = relationship(
        back_populates="propietario", cascade="all, delete-orphan"
    )
    pruebas_vida: Mapped[list["PruebaVidaLog"]] = relationship(
        cascade="all, delete-orphan", order_by="desc(PruebaVidaLog.fecha_prueba)"
    )
