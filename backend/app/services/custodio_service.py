# backend/app/services/custodio_service.py
"""
CU-010 a CU-014 — CRUD del directorio de custodios del propietario.

Dominio de negocio: "custodios" (directorio de contactos de confianza).
NO gestiona la vinculación custodio<->bóveda (CU-013/CU-022): eso vive en
boveda_service. Aquí solo se administra el directorio.

Los custodios no tienen cuenta. Sus canales se verifican por separado: el
correo con un token de un solo uso (mismo mecanismo que el correo
secundario del propietario, ver services/tokens.py) y Telegram con un
código que el propio custodio manda al bot (services/telegram_service.py).
"""

from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.boveda import CustodioBoveda
from app.models.codigo_telegram import CodigoVinculacionTelegram
from app.models.custodio import CanalVerificacion, Custodio, VerificacionCustodio
from app.models.dms_atestacion import DmsAtestacion
from app.models.recuperacion import FragmentoDepositado
from app.models.usuario import Usuario
from app.schemas.custodio import CustodioCrearRequest, CustodioEditarRequest
from app.services import notificaciones, suscripcion_service, telegram_service, tokens
from app.services.errores import Conflicto, DatoInvalido, NoEncontrado
from app.services.tokens import EstadoToken

VIGENCIA_VERIFICACION_HORAS = 72


class CustodioNoEncontrado(NoEncontrado):
    """El custodio no existe o no pertenece al propietario -> 404."""


class CustodioConflicto(Conflicto):
    """La operación choca con el estado del custodio -> 409."""


# --------------------------------------------------------------------------
# Lectura
# --------------------------------------------------------------------------


def listar_custodios(db: Session, usuario: Usuario) -> list[Custodio]:
    """CU-010: directorio completo del propietario, más reciente primero."""
    return (
        db.query(Custodio)
        .filter(Custodio.id_propietario == usuario.id)
        .order_by(Custodio.created_at.desc(), Custodio.id.desc())
        .all()
    )


def obtener_custodio_propio(db: Session, usuario: Usuario, id_custodio: int) -> Custodio:
    """
    Devuelve el custodio solo si pertenece al propietario autenticado.
    Lanza CustodioNoEncontrado (404) también cuando el id existe pero es de otro
    propietario, para no revelar su existencia.
    """
    custodio = (
        db.query(Custodio)
        .filter(Custodio.id == id_custodio, Custodio.id_propietario == usuario.id)
        .first()
    )
    if custodio is None:
        raise CustodioNoEncontrado("Custodio no encontrado.")
    return custodio


# --------------------------------------------------------------------------
# Escritura
# --------------------------------------------------------------------------


def _exigir_rn006(usuario: Usuario, correo: str) -> None:
    """RN-006: un propietario no puede registrarse a sí mismo como custodio."""
    propios = {c.lower() for c in (usuario.correo, usuario.correo_sec) if c}
    if correo.lower() in propios:
        raise DatoInvalido(
            "No puedes registrarte a ti mismo como custodio (RN-006). "
            "Usa un correo distinto al de tu cuenta."
        )


def _exigir_correo_unico(
    db: Session, usuario: Usuario, correo: str, excluir_id: int | None = None
) -> None:
    """
    El correo no puede estar ya en uso por otro custodio del mismo
    propietario (el índice UNIQUE uq_cust_prop_correo es el respaldo; aquí se
    da el mensaje claro). Telegram no entra aquí: se vincula por chat_id.
    """
    otros = db.query(Custodio).filter(
        Custodio.id_propietario == usuario.id, Custodio.correo == correo
    )
    if excluir_id is not None:
        otros = otros.filter(Custodio.id != excluir_id)
    if otros.first() is not None:
        raise DatoInvalido("Ya tienes un custodio registrado con ese correo.")


def _verificar_correo(db: Session, usuario: Usuario, custodio: Custodio) -> None:
    """Emite el token de confirmación del correo del custodio (solo sirve el
    último, ver services/tokens.py) y le manda el enlace."""
    _, en_claro = tokens.emitir(
        db,
        VerificacionCustodio,
        VerificacionCustodio.id_custodio == custodio.id,
        vigencia=timedelta(hours=VIGENCIA_VERIFICACION_HORAS),
        id_custodio=custodio.id,
        canal=CanalVerificacion.correo,
        destino=custodio.correo,
    )
    notificaciones.encolar_correo(
        db,
        custodio.correo,
        "custodio_verificacion",
        custodio=custodio.nombre,
        propietario=usuario.nombre,
        enlace=f"{settings.FRONTEND_CONFIRM_CUSTODIO_URL}?token={en_claro}",
    )


def crear_custodio(db: Session, usuario: Usuario, datos: CustodioCrearRequest) -> Custodio:
    """
    CU-011. Crea el custodio y le manda el enlace de verificación de correo.
    Telegram se vincula después (solicitar_vinculo_telegram), no en el alta.
    """
    suscripcion_service.exigir_cupo_custodio(db, usuario)
    _exigir_rn006(usuario, datos.correo)
    _exigir_correo_unico(db, usuario, datos.correo)

    custodio = Custodio(
        id_propietario=usuario.id,
        nombre=datos.nombre,
        paterno=datos.paterno,
        materno=datos.materno,
        parentesco=datos.parentesco,
        correo=datos.correo,
        correo_verificado=False,
        telegram_verificado=False,
    )
    db.add(custodio)
    db.flush()  # asigna custodio.id
    _verificar_correo(db, usuario, custodio)
    db.refresh(custodio)
    return custodio


def editar_custodio(
    db: Session, usuario: Usuario, id_custodio: int, datos: CustodioEditarRequest
) -> Custodio:
    """
    CU-012. Cambiar el correo lo marca de nuevo como 'no verificado' y
    reenvía la verificación al correo nuevo.
    """
    custodio = obtener_custodio_propio(db, usuario, id_custodio)
    campos = datos.model_dump(exclude_unset=True)

    # nombre/parentesco son NOT NULL: un `null` explícito no los vacía.
    if campos.get("nombre") is not None:
        custodio.nombre = campos["nombre"]
    if "paterno" in campos:
        custodio.paterno = campos["paterno"]
    if "materno" in campos:
        custodio.materno = campos["materno"]
    if campos.get("parentesco") is not None:
        custodio.parentesco = campos["parentesco"]

    correo = campos.get("correo")
    if correo is not None and correo != custodio.correo:
        _exigir_rn006(usuario, correo)
        _exigir_correo_unico(db, usuario, correo, excluir_id=custodio.id)
        custodio.correo = correo
        custodio.correo_verificado = False
        _verificar_correo(db, usuario, custodio)

    db.flush()
    db.refresh(custodio)
    return custodio


def reenviar_verificacion_correo(db: Session, usuario: Usuario, id_custodio: int) -> Custodio:
    """
    Reemite el enlace de verificación de correo (token nuevo, 72 h) para un
    custodio cuyo correo aún no está verificado — p.ej. el enlace anterior
    expiró o se perdió.
    """
    custodio = obtener_custodio_propio(db, usuario, id_custodio)
    if custodio.correo_verificado:
        raise DatoInvalido("El correo de ese custodio ya está verificado.")
    _verificar_correo(db, usuario, custodio)
    return custodio


def solicitar_vinculo_telegram(
    db: Session, usuario: Usuario, id_custodio: int
) -> tuple[Custodio, int]:
    """
    Dispara la vinculación de Telegram para un custodio del directorio:
    genera el código de un solo uso y le manda el deep link POR CORREO, para
    que sea el propio custodio quien le escriba al bot. El propietario nunca
    ve ni introduce un @usuario — solo dispara el envío. Devuelve
    (custodio, segundos de vigencia del enlace).
    """
    custodio = obtener_custodio_propio(db, usuario, id_custodio)
    enlace = telegram_service.generar_codigo_custodio(db, custodio)
    notificaciones.encolar_correo(
        db,
        custodio.correo,
        "custodio_telegram",
        custodio=custodio.nombre,
        propietario=usuario.nombre,
        enlace=enlace.deep_link,
    )
    return custodio, enlace.expira_en_segundos


def desvincular_telegram(db: Session, usuario: Usuario, id_custodio: int) -> None:
    """Desvincula el chat de Telegram del custodio (puede volver a vincularse después)."""
    custodio = obtener_custodio_propio(db, usuario, id_custodio)
    custodio.telegram_chat_id = None
    custodio.telegram_verificado = False


def purgar_referencias(db: Session, ids_custodios: list[int]) -> None:
    """
    Quita todo lo que referencia a estos custodios por FK (sin ON DELETE en
    el esquema) para que se puedan borrar: tokens de verificación, códigos de
    Telegram y votos DMS históricos. Los depósitos de recuperación se
    conservan: su `id_custodio` es solo informativo y queda en NULL.
    """
    if not ids_custodios:
        return
    db.query(VerificacionCustodio).filter(
        VerificacionCustodio.id_custodio.in_(ids_custodios)
    ).delete(synchronize_session=False)
    db.query(CodigoVinculacionTelegram).filter(
        CodigoVinculacionTelegram.id_custodio.in_(ids_custodios)
    ).delete(synchronize_session=False)
    db.query(DmsAtestacion).filter(DmsAtestacion.id_custodio.in_(ids_custodios)).delete(
        synchronize_session=False
    )
    db.query(FragmentoDepositado).filter(FragmentoDepositado.id_custodio.in_(ids_custodios)).update(
        {FragmentoDepositado.id_custodio: None}, synchronize_session=False
    )


def eliminar_custodio(db: Session, usuario: Usuario, id_custodio: int) -> None:
    """
    CU-014. Solo se puede borrar un custodio que ya no custodia ningún
    fragmento: si sigue vinculado a alguna bóveda, primero hay que
    desvincularlo desde "Gestionar Bóveda" (409). Con eso, sus votos DMS
    solo pueden ser de episodios ya cerrados (la asignación se congela
    mientras el interruptor está en curso) y se borran con él.
    """
    custodio = obtener_custodio_propio(db, usuario, id_custodio)

    vinculos = db.query(CustodioBoveda).filter(CustodioBoveda.id_custodio == custodio.id).count()
    if vinculos:
        raise CustodioConflicto(
            f"{custodio.nombre} custodia fragmentos de {vinculos} bóveda(s). "
            "Desvincúlalo desde «Gestionar Bóveda» antes de eliminarlo."
        )

    purgar_referencias(db, [custodio.id])
    db.delete(custodio)


def confirmar_canal(db: Session, token: str) -> None:
    """
    Llamado desde el link del correo, sin sesión activa (mismo criterio que
    confirmar_correo_secundario / reset-password).

    Idempotente: si el token ya se usó (el custodio recarga la página de
    confirmación, hace doble clic, etc.) NO se lanza error — la confirmación
    ya ocurrió y el resultado es el mismo. El enlace es válido las 72 h
    completas; solo se rechaza si de verdad expiró o si el token no existe.
    """
    registro, estado = tokens.buscar(db, VerificacionCustodio, token)
    if estado is EstadoToken.USADO:
        return  # ya confirmado antes — no-op
    if estado is EstadoToken.EXPIRADO:
        raise DatoInvalido("El enlace de confirmación expiró (válido 72 horas).")
    if registro is None:
        raise DatoInvalido("Enlace de confirmación no válido.")

    custodio = db.get(Custodio, registro.id_custodio)
    assert custodio is not None  # FK
    custodio.correo_verificado = True
    registro.usado = True
