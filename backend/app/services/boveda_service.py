# backend/app/services/boveda_service.py
"""
Dominio de bóvedas: CRUD, compromisos Feldman VSS y vinculación
custodio <-> fragmento (CU-019 a CU-023, CU-027, CU-028).

Zero-knowledge: aquí NO entra jamás la llave maestra ni los valores `y` de
los fragmentos. El navegador ejecuta sss.split() (WASM) y este servicio solo
persiste la parte pública: compromisos Feldman VSS + coordenadas x + n/k.

Los compromisos se guardan tal cual para que, en la recuperación (CU-032)
y en la atestación del DMS, el navegador de cada custodio verifique su
fragmento con Feldman VSS antes de usarlo, sin que el servidor conozca el
secreto.
"""

import hmac
import secrets
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import seguridad
from app.models.activo import ActivoDigital
from app.models.boveda import Boveda, CompromisoVss, CustodioBoveda, EstadoBoveda
from app.models.custodio import Custodio
from app.models.recuperacion import FragmentoDepositado, SesionRecuperacion
from app.models.usuario import Usuario
from app.schemas.boveda import (
    MIN_N,
    AsignacionRequest,
    BovedaCrearRequest,
    BovedaEditarRequest,
    CompromisosVssRequest,
)
from app.services import almacenamiento_service, cuota
from app.services.dms.estados import EN_CURSO
from app.services.errores import Conflicto, DatoInvalido, NoEncontrado, Prohibido


class BovedaNoEncontrada(NoEncontrado):
    """La bóveda/custodio no existe o no pertenece al propietario -> 404."""


class BovedaConflicto(Conflicto):
    """La operación choca con el estado actual de la bóveda -> 409."""


class CustodiosInsuficientes(Conflicto):
    """Aún no tiene suficientes custodios con un canal confirmado."""


class PassphraseIncorrecta(Prohibido):
    """La pass-phrase de la bóveda (verificador) no coincide -> 403."""


def _exigir_passphrase(boveda: Boveda, verificador: str) -> None:
    """
    Comprueba el verificador de la pass-phrase de la bóveda. El servidor solo
    compara sha256(verifier) contra lo almacenado; nunca puede derivar la DEK.
    Requerido en toda operación sobre la bóveda salvo el borrado (que usa la
    contraseña de la cuenta).
    """
    esperado = boveda.passphrase_verificador or ""
    recibido = seguridad.hash_token((verificador or "").strip().lower())
    if not hmac.compare_digest(recibido, esperado):
        raise PassphraseIncorrecta("Pass-phrase de la bóveda incorrecta.")


BYTES_PID = 16  # -> 22 chars urlsafe base64 sin padding


def _generar_pid(db: Session) -> str:
    for _ in range(5):
        pid = secrets.token_urlsafe(BYTES_PID)
        if db.query(Boveda.id).filter(Boveda.pid == pid).first() is None:
            return pid
    raise RuntimeError("No se pudo generar un PID único para la bóveda.")


def _contar_vinculados(db: Session, id_boveda: int) -> int:
    return (
        db.query(func.count(CustodioBoveda.id))
        .filter(CustodioBoveda.id_boveda == id_boveda)
        .scalar()
        or 0
    )


def _fila_boveda(b: Boveda, vinculados: int, usado: int, cuota: int) -> dict[str, Any]:
    """Forma de BovedaResponse (única definición para detalle y listado)."""
    return {
        "id": b.id,
        "pid": b.pid,
        "nombre": b.nombre,
        "categoria": b.categoria,
        "mensaje_custodios": b.mensaje_custodios,
        "kdf": {"algo": b.kdf_algo, "salt": b.kdf_salt, "params": b.kdf_params},
        "umbral_k": b.umbral_k,
        "total_fragmentos_n": b.total_fragmentos_n,
        "estado": b.estado.value if hasattr(b.estado, "value") else b.estado,
        "custodios_vinculados": vinculados,
        "usado_bytes": usado,
        "cuota_bytes": cuota,
        "created_at": b.created_at,
    }


def serializar_boveda(
    db: Session, boveda: Boveda, usuario: Usuario | None = None
) -> dict[str, Any]:
    """
    Forma de BovedaResponse. Si se pasa `usuario`, incluye el uso de
    almacenamiento y la cuota del propietario (para el indicador de espacio).
    """
    usado = limite = 0
    if usuario is not None:
        usado, limite = cuota.uso_y_cuota(db, usuario)
    return _fila_boveda(boveda, _contar_vinculados(db, boveda.id), usado, limite)


# --------------------------------------------------------------------------
# CRUD de bóvedas
# --------------------------------------------------------------------------


def listar_bovedas(db: Session, usuario: Usuario) -> list[dict[str, Any]]:
    """CU-019. Devuelve la forma de BovedaResponse con el conteo de vínculos
    resuelto en una sola consulta agrupada (evita N+1)."""
    conteos: dict[int, int] = dict(
        db.execute(
            select(CustodioBoveda.id_boveda, func.count(CustodioBoveda.id))
            .join(Boveda, Boveda.id == CustodioBoveda.id_boveda)
            .where(Boveda.id_propietario == usuario.id)
            .group_by(CustodioBoveda.id_boveda)
        )
        .tuples()
        .all()
    )
    bovedas = (
        db.query(Boveda)
        .filter(Boveda.id_propietario == usuario.id)
        .order_by(Boveda.created_at.desc(), Boveda.id.desc())
        .all()
    )
    # El uso y la cuota son del propietario: iguales en todas sus bóvedas.
    usado, limite = cuota.uso_y_cuota(db, usuario)
    return [_fila_boveda(b, conteos.get(b.id, 0), usado, limite) for b in bovedas]


def obtener_boveda_propia(db: Session, usuario: Usuario, id_boveda: int) -> Boveda:
    boveda = (
        db.query(Boveda).filter(Boveda.id == id_boveda, Boveda.id_propietario == usuario.id).first()
    )
    if boveda is None:
        raise BovedaNoEncontrada("Bóveda no encontrada.")
    return boveda


def _exigir_custodios_listos(db: Session, usuario: Usuario) -> None:
    """Primer paso antes de crear una bóveda: tener al menos MIN_N custodios
    con correo o Telegram confirmado (a quienes repartir los fragmentos; con
    menos no hay umbral de mayoría válido, RN-006). Así no quedan bóvedas en
    borrador que no se pueden terminar."""
    registrados = db.scalar(
        select(func.count(Custodio.id)).where(Custodio.id_propietario == usuario.id)
    )
    listos = db.scalar(
        select(func.count(Custodio.id)).where(
            Custodio.id_propietario == usuario.id,
            (Custodio.correo_verificado.is_(True)) | (Custodio.telegram_verificado.is_(True)),
        )
    )
    if (listos or 0) < MIN_N:
        raise CustodiosInsuficientes(
            f"Antes de crear una bóveda necesitas al menos {MIN_N} custodios que hayan "
            f"confirmado su correo o su Telegram (tienes {listos or 0} confirmados de "
            f"{registrados or 0} registrados). Regístralos en Custodios."
        )


def crear_boveda(db: Session, usuario: Usuario, datos: BovedaCrearRequest) -> Boveda:
    """
    CU-020: crea la bóveda en estado 'borrador' (aún sin compromisos).
    Guarda la envoltura KDF (no secreta) y el verificador de la pass-phrase
    (hasheado). La pass-phrase y la DEK nunca llegan al servidor.
    """
    cuota.exigir_cupo_boveda(db, usuario)
    _exigir_custodios_listos(db, usuario)

    boveda = Boveda(
        pid=_generar_pid(db),
        id_propietario=usuario.id,
        nombre=datos.nombre,
        categoria=datos.categoria,
        mensaje_custodios=datos.mensaje_custodios,
        kdf_algo=datos.kdf.algo,
        kdf_salt=datos.kdf.salt,
        kdf_params=datos.kdf.params,
        passphrase_verificador=seguridad.hash_token(datos.passphrase_verifier),
        estado=EstadoBoveda.borrador,
    )
    db.add(boveda)
    db.flush()
    db.refresh(boveda)
    return boveda


def verificar_passphrase(db: Session, usuario: Usuario, id_boveda: int, verificador: str) -> Boveda:
    """CU-027: guardia previa a operaciones críticas. 403 si no coincide."""
    boveda = obtener_boveda_propia(db, usuario, id_boveda)
    _exigir_passphrase(boveda, verificador)
    return boveda


def editar_boveda(
    db: Session, usuario: Usuario, id_boveda: int, datos: BovedaEditarRequest
) -> Boveda:
    """CU-023: metadatos (nombre / categoría / mensaje). Requiere pass-phrase de la bóveda."""
    boveda = obtener_boveda_propia(db, usuario, id_boveda)
    _exigir_passphrase(boveda, datos.passphrase_verifier)
    campos = datos.model_dump(exclude_unset=True)
    if campos.get("nombre") is not None:  # NOT NULL: un `null` explícito no lo vacía
        boveda.nombre = campos["nombre"]
    if "categoria" in campos:
        boveda.categoria = campos["categoria"]
    if "mensaje_custodios" in campos:
        boveda.mensaje_custodios = campos["mensaje_custodios"]
    db.flush()
    db.refresh(boveda)
    return boveda


def purgar_boveda(db: Session, boveda: Boveda) -> None:
    """Borra una bóveda y TODO su rastro: activos + blobs, sesiones de
    recuperación con sus depósitos cifrados, asignaciones de custodios y
    compromisos VSS (las FK del esquema no tienen ON DELETE; los votos DMS
    que la referencian sí quedan en NULL). NO valida contraseña ni
    propiedad — el llamador es responsable de eso.
    Reutilizado por `eliminar_boveda` (CU-028) y por el borrado de cuenta."""
    almacenamiento_service.borrar_prefijo(f"{boveda.pid}/")
    db.query(ActivoDigital).filter(ActivoDigital.id_boveda == boveda.id).delete()
    sesiones = db.query(SesionRecuperacion.id).filter(SesionRecuperacion.id_boveda == boveda.id)
    db.query(FragmentoDepositado).filter(
        FragmentoDepositado.id_sesion.in_(sesiones.scalar_subquery())
    ).delete(synchronize_session=False)
    db.query(SesionRecuperacion).filter(SesionRecuperacion.id_boveda == boveda.id).delete(
        synchronize_session=False
    )
    db.query(CustodioBoveda).filter(CustodioBoveda.id_boveda == boveda.id).delete()
    db.query(CompromisoVss).filter(CompromisoVss.id_boveda == boveda.id).delete()
    db.delete(boveda)


def eliminar_boveda(db: Session, usuario: Usuario, id_boveda: int, contrasena: str) -> None:
    """
    CU-028. Exige la contraseña de la CUENTA (no la pass-phrase de la
    bóveda), igual que DELETE /users/me, y borra la bóveda con todo su
    rastro (ver `purgar_boveda`).
    """
    boveda = obtener_boveda_propia(db, usuario, id_boveda)
    if not seguridad.verificar_contrasena(contrasena, usuario.hash_pass):
        raise DatoInvalido("Contraseña incorrecta. No se eliminó la bóveda.")

    purgar_boveda(db, boveda)


# --------------------------------------------------------------------------
# Compromisos Feldman VSS
# --------------------------------------------------------------------------


def cargar_vss(
    db: Session, usuario: Usuario, id_boveda: int, datos: CompromisosVssRequest
) -> Boveda:
    """
    CU-021 (cola). Recibe los compromisos públicos y fija n/k.
    Se permite mientras la bóveda esté en 'borrador', o 'activa' sin ningún
    custodio asignado todavía (rehacer un reparto mal hecho antes de
    repartir los .sss). Si ya hay custodios vinculados -> 409.
    """
    boveda = obtener_boveda_propia(db, usuario, id_boveda)
    _exigir_passphrase(boveda, datos.passphrase_verifier)

    if boveda.estado not in (EstadoBoveda.borrador, EstadoBoveda.activa):
        raise BovedaConflicto(
            f"No se pueden cargar compromisos en una bóveda en estado '{boveda.estado.value}'."
        )

    asignados = db.query(CustodioBoveda).filter(CustodioBoveda.id_boveda == boveda.id).count()
    if asignados > 0:
        raise BovedaConflicto(
            "La bóveda ya tiene custodios vinculados; desvincúlalos antes de "
            "regenerar los compromisos."
        )

    existente = db.query(CompromisoVss).filter(CompromisoVss.id_boveda == boveda.id).first()
    if existente is not None:
        existente.commitments_hex = datos.commitments_hex
        existente.x_coords = datos.x_coords
    else:
        db.add(
            CompromisoVss(
                id_boveda=boveda.id,
                commitments_hex=datos.commitments_hex,
                x_coords=datos.x_coords,
            )
        )

    boveda.umbral_k = datos.k
    boveda.total_fragmentos_n = datos.n
    boveda.estado = EstadoBoveda.activa
    db.flush()
    db.refresh(boveda)
    return boveda


def obtener_vss(db: Session, usuario: Usuario, id_boveda: int) -> tuple[Boveda, CompromisoVss]:
    boveda = obtener_boveda_propia(db, usuario, id_boveda)
    vss = db.query(CompromisoVss).filter(CompromisoVss.id_boveda == boveda.id).first()
    if vss is None:
        raise BovedaNoEncontrada("La bóveda aún no tiene compromisos VSS cargados.")
    return boveda, vss


# --------------------------------------------------------------------------
# Vinculación custodio <-> bóveda (CU-022, Paso 3)
# --------------------------------------------------------------------------


def listar_asignaciones(db: Session, usuario: Usuario, id_boveda: int) -> list[dict[str, Any]]:
    boveda = obtener_boveda_propia(db, usuario, id_boveda)
    filas = (
        db.query(CustodioBoveda, Custodio)
        .join(Custodio, Custodio.id == CustodioBoveda.id_custodio)
        .filter(CustodioBoveda.id_boveda == boveda.id)
        .order_by(CustodioBoveda.x_fragmento.asc())
        .all()
    )
    return [
        {
            "id_custodio": c.id,
            "nombre": c.nombre,
            "correo": c.correo,
            "x_fragmento": cb.x_fragmento,
            "created_at": cb.created_at,
        }
        for cb, c in filas
    ]


def _exigir_asignaciones_editables(usuario: Usuario) -> None:
    """
    Congela la asignación custodio<->fragmento de TODAS las bóvedas del
    propietario mientras el Interruptor de Hombre Muerto esté en curso
    (alerta/gracia/gracia_reduccion) — ya puede haber tokens de voto
    emitidos que dependen de la asignación vigente (ver
    dms.registrar_atestacion); cambiarla a medio proceso deja fragmentos
    físicos que ya no coinciden, sin aviso a nadie.
    """
    prop = usuario.propietario
    if prop is not None and prop.status_dms in EN_CURSO:
        raise BovedaConflicto(
            "No puedes modificar los custodios asignados mientras el "
            "Interruptor de Hombre Muerto está en curso (alerta o periodo de "
            "gracia). Espera a que vuelva a estar activo."
        )


def reemplazar_asignaciones(
    db: Session,
    usuario: Usuario,
    id_boveda: int,
    asignaciones: list[AsignacionRequest],
    verificador: str,
) -> list[dict[str, Any]]:
    """
    Paso 3 del wizard: reemplaza de forma atómica TODO el conjunto de
    custodios vinculados a la bóveda. Valida todo antes de tocar nada.

    Se exigen EXACTAMENTE los `n` custodios (uno por fragmento). Con solo `k`
    el esquema no tolera fallos: si un custodio pierde su fragmento ya no se
    alcanza el umbral. Con `n` vinculados el esquema resiste hasta n-k
    pérdidas. "Gestionar Bóveda" también usa este reemplazo por lote para
    cualquier cambio (no hay endpoints de asignación individual).
    """
    boveda = obtener_boveda_propia(db, usuario, id_boveda)
    _exigir_asignaciones_editables(usuario)
    _exigir_passphrase(boveda, verificador)

    vss = db.query(CompromisoVss).filter(CompromisoVss.id_boveda == boveda.id).first()
    if vss is None:
        raise BovedaConflicto("Carga primero los compromisos VSS de la bóveda.")

    x_validas = set(vss.x_coords)
    n = boveda.total_fragmentos_n
    if n is not None and len(asignaciones) != n:
        raise BovedaConflicto(
            f"Debes vincular exactamente los {n} custodios (uno por fragmento); "
            f"recibidos {len(asignaciones)}."
        )

    sin_verificar: list[str] = []
    for asignacion in asignaciones:
        if asignacion.x_fragmento not in x_validas:
            raise BovedaConflicto(
                f"La coordenada x={asignacion.x_fragmento} no pertenece al reparto de esta bóveda."
            )
        custodio = (
            db.query(Custodio)
            .filter(Custodio.id == asignacion.id_custodio, Custodio.id_propietario == usuario.id)
            .first()
        )
        if custodio is None:
            raise BovedaNoEncontrada(f"Custodio {asignacion.id_custodio} no encontrado.")
        if not (custodio.correo_verificado or custodio.telegram_verificado):
            sin_verificar.append(custodio.nombre)

    if sin_verificar:
        raise BovedaConflicto(
            "Estos custodios no tienen ningún canal de comunicación verificado y no "
            f"podrían ser notificados en la recuperación: {', '.join(sin_verificar)}. "
            "Verifícalos antes de vincularlos."
        )

    db.query(CustodioBoveda).filter(CustodioBoveda.id_boveda == boveda.id).delete()
    for asignacion in asignaciones:
        db.add(
            CustodioBoveda(
                id_boveda=boveda.id,
                id_custodio=asignacion.id_custodio,
                x_fragmento=asignacion.x_fragmento,
            )
        )
    db.flush()
    return listar_asignaciones(db, usuario, id_boveda)
