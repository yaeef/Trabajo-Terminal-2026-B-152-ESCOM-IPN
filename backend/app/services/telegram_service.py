# backend/app/services/telegram_service.py
"""
Vinculación de chats de Telegram (propietario o custodio) mediante códigos
de un solo uso y el comando /start del bot. Los mensajes salen por la cola
de notificaciones (services/notificaciones).

Requiere en app/core/config.py (Settings):
    TELEGRAM_BOT_TOKEN: str
    TELEGRAM_BOT_USERNAME: str

El chat_id que se guarda es el que Telegram entrega cuando el propio
usuario le escribe al bot (nunca un @username tecleado por un tercero).
"""

from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.codigo_telegram import CodigoVinculacionTelegram
from app.models.custodio import Custodio
from app.models.usuario import Usuario
from app.schemas.usuario import CodigoTelegramResponse
from app.services import notificaciones, tokens

VIGENCIA_CODIGO_MIN = 10
LONGITUD_CODIGO = 8


def _emitir_codigo(
    db: Session, *, id_usuario: int | None = None, id_custodio: int | None = None
) -> CodigoTelegramResponse:
    """
    Código de un solo uso para el propietario (`id_usuario`) o para un
    custodio (`id_custodio`) — exactamente uno de los dos. Devuelve el deep
    link https://t.me/bot?start=CODIGO (ver services/tokens.py).
    """
    del_dueno = (
        CodigoVinculacionTelegram.id_usuario == id_usuario
        if id_usuario is not None
        else CodigoVinculacionTelegram.id_custodio == id_custodio
    )
    _, codigo = tokens.emitir(
        db,
        CodigoVinculacionTelegram,
        del_dueno,
        vigencia=timedelta(minutes=VIGENCIA_CODIGO_MIN),
        valor=tokens.codigo_aleatorio(LONGITUD_CODIGO),
        id_usuario=id_usuario,
        id_custodio=id_custodio,
    )
    return CodigoTelegramResponse(
        deep_link=f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start={codigo}",
        expira_en_segundos=VIGENCIA_CODIGO_MIN * 60,
    )


def generar_codigo_propietario(db: Session, usuario: Usuario) -> CodigoTelegramResponse:
    """Paso 1 (propietario): el deep link se muestra en la app."""
    return _emitir_codigo(db, id_usuario=usuario.id)


def generar_codigo_custodio(db: Session, custodio: Custodio) -> CodigoTelegramResponse:
    """
    Paso 1 (custodio): el propietario lo dispara desde el directorio de
    custodios y el deep link se manda por correo al custodio
    (custodio_service.solicitar_vinculo_telegram), nunca se le muestra al
    propietario: así es el propio custodio quien escribe al bot y queda
    vinculado con su chat_id real.
    """
    return _emitir_codigo(db, id_custodio=custodio.id)


def responder_sin_codigo(db: Session, chat_id: int | str) -> None:
    notificaciones.encolar_telegram(db, chat_id, "sin_codigo")


def procesar_start(db: Session, chat_id: int | str, codigo: str) -> bool:
    """
    Paso 2: llamado desde el webhook al recibir '/start <codigo>'.
    El código pudo haberse generado para un propietario o para un custodio —
    se distingue por cuál de id_usuario / id_custodio viene lleno en la fila.
    """
    vinculo = tokens.vigente(db, CodigoVinculacionTelegram, codigo.strip().upper())
    if vinculo is None:
        notificaciones.encolar_telegram(db, chat_id, "codigo_invalido")
        return False

    if vinculo.id_custodio is not None:
        custodio = db.get(Custodio, vinculo.id_custodio)
        if custodio is None:
            notificaciones.encolar_telegram(db, chat_id, "custodio_inexistente")
            return False
        custodio.telegram_chat_id = str(chat_id)
        custodio.telegram_verificado = True
        vinculo.usado = True
        notificaciones.encolar_telegram(db, chat_id, "vinculado_custodio")
        return True

    usuario = db.get(Usuario, vinculo.id_usuario)
    if usuario is None:
        notificaciones.encolar_telegram(db, chat_id, "usuario_inexistente")
        return False
    usuario.id_telegram = str(chat_id)
    vinculo.usado = True
    notificaciones.encolar_telegram(db, chat_id, "vinculado_propietario")
    return True


def desvincular(usuario: Usuario) -> None:
    usuario.id_telegram = None
