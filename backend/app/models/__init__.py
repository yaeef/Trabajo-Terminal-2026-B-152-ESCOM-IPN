"""
Registro de todos los modelos ORM.

Importar `app.models` deja el mapeo completo (relaciones por nombre como
"TokenRecuperacion" o "PruebaVidaLog" resueltas) sin depender de que otro
módulo los haya importado antes. Lo usan la app y las pruebas.
"""

from app.models.activo import ActivoDigital, EstadoActivo
from app.models.admin_auditoria import AccionAdmin, AdminAuditoria
from app.models.boveda import Boveda, CompromisoVss, CustodioBoveda, EstadoBoveda
from app.models.codigo_telegram import CodigoVinculacionTelegram
from app.models.custodio import CanalVerificacion, Custodio, VerificacionCustodio
from app.models.dms_atestacion import DmsAtestacion, SentidoAtestacion
from app.models.impago import AvisoEnviado, CicloImpago, EstadoCicloImpago, MotivoCierreImpago
from app.models.notificacion import CanalNotificacion, EstadoNotificacion, Notificacion
from app.models.prueba_vida_log import MetodoPruebaVida, PruebaVidaLog
from app.models.recuperacion import (
    EstadoSesionRecuperacion,
    FragmentoDepositado,
    SesionRecuperacion,
)
from app.models.suscripcion import (
    EstadoReserva,
    OrigenCobertura,
    PropietarioSuscripcion,
    ReservaContinuidad,
    Suscripcion,
)
from app.models.token_recuperacion import TokenRecuperacion
from app.models.usuario import EstadoDMS, Propietario, RolUsuario, Usuario
from app.models.verificacion_correo import VerificacionCorreoRegistro, VerificacionCorreoSec

__all__ = [
    "AccionAdmin",
    "ActivoDigital",
    "AdminAuditoria",
    "AvisoEnviado",
    "Boveda",
    "CanalNotificacion",
    "CanalVerificacion",
    "CicloImpago",
    "CodigoVinculacionTelegram",
    "CompromisoVss",
    "Custodio",
    "CustodioBoveda",
    "DmsAtestacion",
    "EstadoActivo",
    "EstadoBoveda",
    "EstadoCicloImpago",
    "EstadoDMS",
    "EstadoNotificacion",
    "EstadoReserva",
    "EstadoSesionRecuperacion",
    "FragmentoDepositado",
    "MetodoPruebaVida",
    "MotivoCierreImpago",
    "Notificacion",
    "OrigenCobertura",
    "Propietario",
    "PropietarioSuscripcion",
    "PruebaVidaLog",
    "ReservaContinuidad",
    "RolUsuario",
    "SentidoAtestacion",
    "SesionRecuperacion",
    "Suscripcion",
    "TokenRecuperacion",
    "Usuario",
    "VerificacionCorreoRegistro",
    "VerificacionCorreoSec",
    "VerificacionCustodio",
]
