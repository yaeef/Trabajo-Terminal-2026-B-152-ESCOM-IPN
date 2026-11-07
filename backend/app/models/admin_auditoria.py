# backend/app/models/admin_auditoria.py
import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.sesion import Base


class AccionAdmin(enum.StrEnum):
    cancelar_eliminacion = "cancelar_eliminacion"
    purgar_cuenta = "purgar_cuenta"
    extender_plazo_dms = "extender_plazo_dms"
    reenviar_aviso_dms = "reenviar_aviso_dms"
    forzar_barrido_dms = "forzar_barrido_dms"
    reenviar_verificacion_custodio = "reenviar_verificacion_custodio"
    cambiar_plan = "cambiar_plan"
    reintentar_notificaciones = "reintentar_notificaciones"


class AdminAuditoria(Base):
    """
    Bitácora append-only de acciones administrativas: quién (admin), sobre
    quién (propietario afectado, si aplica), qué acción y por qué. Es la
    única forma de trazabilidad de lo que hace el panel admin — ninguna
    acción admin se aplica sin dejar aquí su motivo.
    """

    __tablename__ = "admin_auditoria"
    __table_args__ = (Index("idx_admin_aud_propietario", "id_propietario_afectado", "creado_en"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    id_admin: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
    id_propietario_afectado: Mapped[int | None] = mapped_column(ForeignKey("propietario.id"))
    accion: Mapped[AccionAdmin] = mapped_column(Enum(AccionAdmin))
    motivo: Mapped[str] = mapped_column(String(500))
    creado_en: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
