# backend/app/services/activo_service.py
"""
Activos digitales de una bóveda (CU-024 a CU-026).

Zero-knowledge: el navegador cifra el archivo (AES-256-GCM con la DEK de la
bóveda) y lo sube DIRECTO a Blob Storage con un SAS de vida corta. Este
servicio solo emite SAS, valida cuota y pass-phrase, y persiste metadatos.
"""

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.tiempo import ahora
from app.models.activo import ActivoDigital, EstadoActivo
from app.models.boveda import Boveda
from app.models.usuario import Usuario
from app.schemas.activo import IniciarSubidaRequest
from app.services import almacenamiento_service, boveda_service, cuota

VIGENCIA_PENDIENTE_HORAS = 2  # filas 'pendiente' sin confirmar que se pueden purgar


# --------------------------------------------------------------------------
# Housekeeping
# --------------------------------------------------------------------------


def _purgar_pendientes(db: Session, id_boveda: int) -> None:
    """Borra (fila y blob) las subidas que se iniciaron hace más de
    VIGENCIA_PENDIENTE_HORAS y nunca se confirmaron."""
    limite = ahora() - timedelta(hours=VIGENCIA_PENDIENTE_HORAS)
    viejos = (
        db.query(ActivoDigital)
        .filter(
            ActivoDigital.id_boveda == id_boveda,
            ActivoDigital.estado == EstadoActivo.pendiente,
            ActivoDigital.created_at < limite,
        )
        .all()
    )
    for a in viejos:
        almacenamiento_service.borrar_blob(a.blob_name)
        db.delete(a)


# --------------------------------------------------------------------------
# Operaciones
# --------------------------------------------------------------------------


def _obtener_activo_propio(db: Session, boveda: Boveda, id_activo: int) -> ActivoDigital:
    a = (
        db.query(ActivoDigital)
        .filter(ActivoDigital.id == id_activo, ActivoDigital.id_boveda == boveda.id)
        .first()
    )
    if a is None:
        raise boveda_service.BovedaNoEncontrada("Activo no encontrado.")
    return a


def listar(db: Session, usuario: Usuario, id_boveda: int) -> list[ActivoDigital]:
    boveda = boveda_service.obtener_boveda_propia(db, usuario, id_boveda)
    _purgar_pendientes(db, boveda.id)
    return (
        db.query(ActivoDigital)
        .filter(
            ActivoDigital.id_boveda == boveda.id,
            ActivoDigital.estado == EstadoActivo.activo,
        )
        .order_by(ActivoDigital.created_at.desc(), ActivoDigital.id.desc())
        .all()
    )


def iniciar_subida(
    db: Session, usuario: Usuario, id_boveda: int, datos: IniciarSubidaRequest
) -> dict[str, Any]:
    """CU-024, paso 1: valida la cuota con el tamaño declarado, crea la fila
    'pendiente' y devuelve un SAS de escritura para subir el blob cifrado."""
    boveda = boveda_service.verificar_passphrase(db, usuario, id_boveda, datos.passphrase_verifier)
    _purgar_pendientes(db, boveda.id)

    usado, limite = cuota.uso_y_cuota(db, usuario)
    if usado + datos.tamano_cifrado > limite:
        libre = max(limite - usado, 0)
        raise boveda_service.BovedaConflicto(
            f"No hay espacio suficiente: quedan {libre} bytes de tu cuota "
            f"({limite} bytes) y este archivo cifrado ocupa {datos.tamano_cifrado}."
        )

    nombre_blob = f"{boveda.pid}/{uuid.uuid4().hex}"
    activo = ActivoDigital(
        id_boveda=boveda.id,
        nombre_original=datos.nombre,
        mime=datos.mime,
        plantilla=datos.plantilla,
        tamano_bytes=datos.tamano_bytes,
        tamano_cifrado=datos.tamano_cifrado,
        blob_name=nombre_blob,
        iv=bytes.fromhex(datos.iv_hex),
        sha256_plano=datos.sha256_plano,
        estado=EstadoActivo.pendiente,
    )
    db.add(activo)
    db.flush()

    return {
        "activo_id": activo.id,
        "blob_name": nombre_blob,
        "sas_url": almacenamiento_service.url_escritura(nombre_blob),
        "expira_en_segundos": almacenamiento_service.MINUTOS_SAS_ESCRITURA * 60,
    }


def confirmar_subida(
    db: Session, usuario: Usuario, id_boveda: int, id_activo: int, verificador: str
) -> ActivoDigital:
    """CU-024, paso 3: el navegador ya subió el blob (paso 2). Se comprueba
    que exista y que su tamaño REAL quepa en la cuota; idempotente si ya
    estaba activo."""
    boveda = boveda_service.verificar_passphrase(db, usuario, id_boveda, verificador)
    activo = _obtener_activo_propio(db, boveda, id_activo)

    if activo.estado == EstadoActivo.activo:
        return activo

    tamano = almacenamiento_service.tamano_blob(activo.blob_name)
    if tamano is None:
        raise boveda_service.BovedaConflicto("El archivo no se encuentra en el almacenamiento.")
    # El SAS de escritura no limita el tamaño: el cliente pudo declarar poco en
    # `iniciar_subida` y subir mucho más. La cuota se re-verifica con el tamaño
    # REAL (el pendiente aún no cuenta en el uso) antes de aceptarlo.
    usado, limite = cuota.uso_y_cuota(db, usuario)
    if usado + tamano > limite:
        almacenamiento_service.borrar_blob(activo.blob_name)
        db.delete(activo)
        # El blob ya no existe: el descarte se confirma aunque la petición
        # termine en error (la unidad de trabajo revertiría todo lo demás).
        db.commit()
        raise boveda_service.BovedaConflicto(
            "El archivo subido excede el espacio disponible de tu plan y se descartó."
        )
    # Se guarda el tamaño real observado (evita desincronías por el overhead del cliente).
    activo.tamano_cifrado = tamano
    activo.estado = EstadoActivo.activo
    db.flush()
    db.refresh(activo)
    return activo


def datos_descarga(activo: ActivoDigital) -> dict[str, Any]:
    """Forma de DescargaResponse: SAS de lectura + IV para que el navegador
    descargue y descifre. La comparten el propietario y la recuperación."""
    return {
        "sas_url": almacenamiento_service.url_lectura(activo.blob_name),
        "iv_hex": activo.iv.hex(),
        "nombre_original": activo.nombre_original,
        "mime": activo.mime,
        "expira_en_segundos": almacenamiento_service.MINUTOS_SAS_LECTURA * 60,
    }


def preparar_descarga(
    db: Session, usuario: Usuario, id_boveda: int, id_activo: int, verificador: str
) -> dict[str, Any]:
    """CU-026: descarga de un activo propio; requiere la pass-phrase."""
    boveda = boveda_service.verificar_passphrase(db, usuario, id_boveda, verificador)
    activo = _obtener_activo_propio(db, boveda, id_activo)
    if activo.estado != EstadoActivo.activo:
        raise boveda_service.BovedaConflicto("El activo aún no está disponible.")
    return datos_descarga(activo)


def eliminar(
    db: Session, usuario: Usuario, id_boveda: int, id_activo: int, verificador: str
) -> None:
    boveda = boveda_service.verificar_passphrase(db, usuario, id_boveda, verificador)
    activo = _obtener_activo_propio(db, boveda, id_activo)
    almacenamiento_service.borrar_blob(activo.blob_name)
    db.delete(activo)
