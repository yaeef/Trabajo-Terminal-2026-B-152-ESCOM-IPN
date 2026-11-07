# backend/app/services/recuperacion_service.py
"""
CU-029 a CU-035 — Portal público de recuperación.

Localización de bóveda por PID + sesión efímera (Beneficiario Principal +
custodios). El servidor jamás ve un fragmento (x,y) en claro: cada depósito
llega cifrado (ECIES X25519 + AES-256-GCM) hacia la llave pública de sesión
del BP, generada/re-derivada 100% en su navegador. Aquí solo se relé, se
valida forma/estado, y se aplican las reglas de negocio que SÍ puede
verificar sin conocer ningún secreto (una sesión activa a la vez, el
cooldown de "no el mismo fundador de inmediato").
"""

from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tiempo import ahora, utc
from app.models.activo import ActivoDigital, EstadoActivo
from app.models.boveda import Boveda, CompromisoVss, CustodioBoveda, EstadoBoveda
from app.models.custodio import Custodio
from app.models.recuperacion import (
    EstadoSesionRecuperacion,
    FragmentoDepositado,
    SesionRecuperacion,
)
from app.schemas.recuperacion import (
    BovedaRecuperacionResponse,
    CrearSesionRequest,
    DepositarFragmentoRequest,
    DepositoBase,
    FragmentoDepositadoResponse,
    SesionEstadoResponse,
)
from app.services import activo_service
from app.services.errores import Conflicto, NoEncontrado


class RecuperacionNoEncontrada(NoEncontrado):
    """La bóveda o la sesión no existen (o no califican) -> 404."""


class RecuperacionConflicto(Conflicto):
    """La operación choca con el estado actual de la sesión/bóveda -> 409."""


# ==========================================================================
# CU-029 — Localización por PID
# ==========================================================================
def buscar_boveda(db: Session, pid: str) -> Boveda | None:
    """La bóveda con ese PID, solo si está 'en_recuperacion' (None si no)."""
    pid = (pid or "").strip()
    if not pid:
        return None
    return (
        db.query(Boveda)
        .filter(Boveda.pid == pid, Boveda.estado == EstadoBoveda.en_recuperacion)
        .first()
    )


def a_respuesta(db: Session, boveda: Boveda) -> BovedaRecuperacionResponse:
    """Lo que ve quien localiza la bóveda: contexto, ventana W y compromisos VSS."""
    ventana = None
    if boveda.recuperacion_iniciada_en is not None:
        ventana = boveda.recuperacion_iniciada_en + timedelta(
            days=settings.DMS_RECOVERY_WINDOW_DIAS
        )
    vss = db.query(CompromisoVss).filter(CompromisoVss.id_boveda == boveda.id).first()
    return BovedaRecuperacionResponse(
        pid=boveda.pid,
        nombre=boveda.nombre,
        categoria=boveda.categoria,
        mensaje_custodios=boveda.mensaje_custodios,
        umbral_k=boveda.umbral_k,
        total_fragmentos_n=boveda.total_fragmentos_n,
        recuperacion_iniciada_en=boveda.recuperacion_iniciada_en,
        ventana_expira_en=ventana,
        commitments_hex=vss.commitments_hex if vss else None,
        x_coords=vss.x_coords if vss else None,
    )


# ==========================================================================
# Sesión efímera — helpers internos
# ==========================================================================
def _sesion_vigente(db: Session, boveda: Boveda) -> SesionRecuperacion | None:
    """La sesión 'activa' más reciente, si no expiró ya. La caducidad se
    evalúa aquí con `expira_en` (no hay barrido periódico de sesiones): si
    ya venció, se marca 'expirada' en ese momento."""
    sesion = (
        db.query(SesionRecuperacion)
        .filter(
            SesionRecuperacion.id_boveda == boveda.id,
            SesionRecuperacion.estado == EstadoSesionRecuperacion.activa,
        )
        .order_by(SesionRecuperacion.creada_en.desc())
        .first()
    )
    if sesion is None:
        return None
    if ahora() >= utc(sesion.expira_en):
        sesion.estado = EstadoSesionRecuperacion.expirada
        return None
    return sesion


def _en_cooldown(db: Session, boveda: Boveda, x: int) -> bool:
    """RN: quien fundó una sesión sin llegar a quórum no puede fundar otra
    hasta que se hayan creado (n-k) sesiones más para esta bóveda."""
    n = boveda.total_fragmentos_n or 0
    k = boveda.umbral_k or 0
    ventana = max(n - k, 0)
    if ventana == 0:
        return False
    recientes = (
        db.query(SesionRecuperacion)
        .filter(SesionRecuperacion.id_boveda == boveda.id)
        .order_by(SesionRecuperacion.creada_en.desc())
        .limit(ventana)
        .all()
    )
    return any(s.x_fundador == x for s in recientes)


def _agregar_deposito(
    db: Session, boveda: Boveda, sesion: SesionRecuperacion, datos: DepositoBase
) -> FragmentoDepositado:
    existente = (
        db.query(FragmentoDepositado)
        .filter(
            FragmentoDepositado.id_sesion == sesion.id,
            FragmentoDepositado.x_fragmento == datos.x_fragmento,
        )
        .first()
    )
    if existente is not None:
        raise RecuperacionConflicto("Ese fragmento ya fue depositado en esta sesión.")

    # Match informativo contra el directorio ya registrado — no es un gate:
    # el fragmento mismo es la credencial, esto solo enriquece la auditoría.
    id_custodio = (
        db.query(CustodioBoveda.id_custodio)
        .filter(
            CustodioBoveda.id_boveda == boveda.id, CustodioBoveda.x_fragmento == datos.x_fragmento
        )
        .scalar()
    )

    deposito = FragmentoDepositado(
        id_sesion=sesion.id,
        x_fragmento=datos.x_fragmento,
        epk_hex=datos.epk_hex,
        iv=bytes.fromhex(datos.iv_hex),
        ciphertext_hex=datos.ciphertext_hex,
        nombre_declarado=datos.nombre_declarado,
        vinculo_declarado=datos.vinculo_declarado,
        id_custodio=id_custodio,
    )
    db.add(deposito)
    return deposito


# ==========================================================================
# Sesión efímera — operaciones públicas
# ==========================================================================
def crear_sesion(db: Session, boveda: Boveda, datos: CrearSesionRequest) -> SesionRecuperacion:
    """CU-030/031: alguien funda la sesión como Beneficiario Principal,
    aportando su propio fragmento (ya validado con VSS en su navegador) y la
    llave pública de la sesión que acaba de generar/derivar."""
    if boveda.estado != EstadoBoveda.en_recuperacion:
        raise RecuperacionConflicto("La bóveda no está en recuperación.")
    if _sesion_vigente(db, boveda) is not None:
        raise RecuperacionConflicto(
            "Ya existe una sesión activa para esta bóveda; únete a ella en vez de crear una nueva."
        )
    if _en_cooldown(db, boveda, datos.x_fragmento):
        raise RecuperacionConflicto(
            "Este fragmento ya fundó una sesión reciente que no llegó a quórum; "
            "por ahora debe fundarla otro custodio."
        )

    sesion = SesionRecuperacion(
        id_boveda=boveda.id,
        x_fundador=datos.x_fragmento,
        bp_public_key=datos.bp_public_key,
        bp_kdf_algo="pbkdf2-sha256",
        bp_kdf_salt=datos.bp_kdf_salt,
        bp_kdf_params=datos.bp_kdf_params,
        estado=EstadoSesionRecuperacion.activa,
        expira_en=ahora() + timedelta(hours=settings.RECUPERACION_SESION_HORAS),
    )
    db.add(sesion)
    db.flush()  # asigna sesion.id sin cerrar la transacción
    _agregar_deposito(db, boveda, sesion, datos)
    db.flush()
    db.refresh(sesion)
    return sesion


def depositar_fragmento(
    db: Session, boveda: Boveda, datos: DepositarFragmentoRequest
) -> FragmentoDepositado:
    """CU-032: un custodio se une a la sesión activa vigente con su fragmento."""
    sesion = _sesion_vigente(db, boveda)
    if sesion is None:
        raise RecuperacionNoEncontrada("No hay una sesión activa para esta bóveda.")
    if datos.bp_public_key != sesion.bp_public_key:
        raise RecuperacionConflicto(
            "La sesión de recuperación cambió desde que la revisaste. Vuelve a cargarla y "
            "decide de nuevo si quieres unirte."
        )
    deposito = _agregar_deposito(db, boveda, sesion, datos)
    db.flush()
    db.refresh(deposito)
    return deposito


def _nombres_custodios(db: Session, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    return dict(
        db.execute(select(Custodio.id, Custodio.nombre).where(Custodio.id.in_(ids))).tuples().all()
    )


def _respuesta_deposito(
    deposito: FragmentoDepositado, nombres: dict[int, str]
) -> FragmentoDepositadoResponse:
    return FragmentoDepositadoResponse(
        x_fragmento=deposito.x_fragmento,
        epk_hex=deposito.epk_hex,
        iv_hex=deposito.iv.hex(),
        ciphertext_hex=deposito.ciphertext_hex,
        nombre_declarado=deposito.nombre_declarado,
        vinculo_declarado=deposito.vinculo_declarado,
        depositado_en=deposito.depositado_en,
        custodio_asignado=nombres.get(deposito.id_custodio) if deposito.id_custodio else None,
    )


def respuesta_deposito(db: Session, deposito: FragmentoDepositado) -> FragmentoDepositadoResponse:
    ids = {deposito.id_custodio} if deposito.id_custodio else set()
    return _respuesta_deposito(deposito, _nombres_custodios(db, ids))


def estado_sesion(db: Session, boveda: Boveda) -> SesionEstadoResponse:
    """
    Estado completo de la sesión vigente, incluidos los ciphertexts: el
    servidor no tiene forma de saber quién es el BP real (nunca vio su
    pass-phrase), así que no hay nada que filtrar por identidad — la
    confidencialidad la da el cifrado, no el control de acceso.
    """
    sesion = _sesion_vigente(db, boveda)
    if sesion is None:
        return SesionEstadoResponse(existe=False)

    depositos = (
        db.query(FragmentoDepositado)
        .filter(FragmentoDepositado.id_sesion == sesion.id)
        .order_by(FragmentoDepositado.depositado_en.asc())
        .all()
    )
    nombres = _nombres_custodios(db, {d.id_custodio for d in depositos if d.id_custodio})
    return SesionEstadoResponse(
        existe=True,
        estado=sesion.estado.value,
        creada_en=sesion.creada_en,
        expira_en=sesion.expira_en,
        x_fundador=sesion.x_fundador,
        reconstruido_en=sesion.reconstruido_en,
        bp_public_key=sesion.bp_public_key,
        bp_kdf_algo=sesion.bp_kdf_algo,
        bp_kdf_salt=sesion.bp_kdf_salt,
        bp_kdf_params=sesion.bp_kdf_params,
        umbral_k=boveda.umbral_k,
        total_fragmentos_n=boveda.total_fragmentos_n,
        depositos=[_respuesta_deposito(d, nombres) for d in depositos],
    )


def marcar_reconstruido(db: Session, boveda: Boveda) -> SesionEstadoResponse:
    """
    El navegador del BP llama esto justo después de reconstruir la DEK con
    éxito (Lagrange local) — es un reporte informativo para que los
    custodios vean confirmación, NO una verificación: el servidor no tiene
    forma de comprobar que de verdad se reconstruyó. Se fija una sola vez
    por sesión (la primera reconstrucción), no se sobreescribe después.
    """
    sesion = _sesion_vigente(db, boveda)
    if sesion is None:
        raise RecuperacionNoEncontrada("No hay una sesión activa para esta bóveda.")
    if sesion.reconstruido_en is None:
        sesion.reconstruido_en = ahora()
        db.flush()
        db.refresh(sesion)
    return estado_sesion(db, boveda)


# ==========================================================================
# CU-034/035 — Activos, una vez reconstruida la DEK (100% en el navegador)
# ==========================================================================
def listar_activos(db: Session, boveda: Boveda) -> list[ActivoDigital]:
    """
    Metadatos en claro de los activos de una bóveda en recuperación — igual
    de inofensivo exponerlos aquí que los compromisos VSS: el contenido
    sigue cifrado, solo el BP con la DEK reconstruida puede leerlo.
    """
    return (
        db.query(ActivoDigital)
        .filter(ActivoDigital.id_boveda == boveda.id, ActivoDigital.estado == EstadoActivo.activo)
        .order_by(ActivoDigital.created_at.desc())
        .all()
    )


def preparar_descarga_activo(db: Session, boveda: Boveda, id_activo: int) -> dict[str, Any]:
    """Descarga de un activo de la bóveda en recuperación (sigue cifrado)."""
    activo = (
        db.query(ActivoDigital)
        .filter(
            ActivoDigital.id == id_activo,
            ActivoDigital.id_boveda == boveda.id,
            ActivoDigital.estado == EstadoActivo.activo,
        )
        .first()
    )
    if activo is None:
        raise RecuperacionNoEncontrada("Activo no encontrado.")
    return activo_service.datos_descarga(activo)
