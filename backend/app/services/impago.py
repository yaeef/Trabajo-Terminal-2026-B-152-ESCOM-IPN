"""
Impago: qué pasa con lo que excede el plan Gratuito cuando termina la
cobertura de pago (el año pagado y, si la tenía, la gracia y la reserva).

    vence sin pago ──► ciclo abierto: solo lectura (los límites del Gratuito
         │             ya impiden crear y subir) y avisos a 30, 15, 7 y 1 día
         │
         ├─ vuelve a pagar ............................ cerrado (pago)
         ├─ deja de exceder el Gratuito ................ cerrado (sin_exceso)
         ├─ el DMS deja de estar activo ................ pausado: no se borra nada
         │     ├─ confirma que vive ─► abierto; recorte a no menos de 15 días
         │     └─ se libera (falleció) ................. cerrado (liberado)
         └─ llega `recorte_en` ......................... recorte → cerrado (recorte)

Nada se recorta mientras el DMS no esté activo: si el propietario murió, sus
herederos recuperan todo, incluido lo que excedía el Gratuito.

El recorte conserva las bóvedas que permite el Gratuito (la elegida por el
propietario o, si no eligió, la de más custodios y luego la más antigua),
borra las demás por completo y, en lo conservado, borra primero los archivos
que por sí solos no caben y después los más recientes hasta quedar dentro
de la cuota. Los custodios no se borran. Lo borrado es irrecuperable.
"""

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tiempo import ahora, hoy
from app.models.activo import ActivoDigital, EstadoActivo
from app.models.boveda import Boveda, CustodioBoveda
from app.models.impago import CicloImpago, EstadoCicloImpago, MotivoCierreImpago
from app.models.suscripcion import PropietarioSuscripcion, Suscripcion
from app.models.usuario import EstadoDMS, Usuario
from app.services import almacenamiento_service, avisos_plan, boveda_service, cuota
from app.services.dms.estados import EN_CURSO
from app.services.errores import NoEncontrado

_UMBRALES = (30, 15, 7, 1)
# Episodio del DMS en curso o cuenta en cola de eliminación: no se sabe aún
# si vive (o si se queda), así que el plazo se detiene.
_PAUSA = EN_CURSO | {EstadoDMS.pausado_eliminacion}
_CIERRE_POR_DMS = {
    EstadoDMS.liberado: MotivoCierreImpago.liberado,
    EstadoDMS.eliminado: MotivoCierreImpago.cuenta,
}


# --------------------------------------------------------------------------
# Lectura y acciones del propietario
# --------------------------------------------------------------------------
def excedente(db: Session, usuario: Usuario) -> list[str]:
    """Lo que excede el Gratuito y el recorte borraría (los custodios de más
    no se borran: solo impiden registrar otros)."""
    return cuota.excesos(cuota.uso_actual(db, usuario), cuota.plan_gratuito(db), custodios=False)


def ciclo_vigente(db: Session, usuario: Usuario) -> CicloImpago | None:
    """El ciclo abierto o en pausa del propietario (como mucho hay uno)."""
    return db.scalars(
        select(CicloImpago)
        .where(
            CicloImpago.id_propietario == usuario.id,
            CicloImpago.estado != EstadoCicloImpago.cerrado,
        )
        .order_by(CicloImpago.id.desc())
        .limit(1)
    ).first()


def estado(db: Session, usuario: Usuario) -> dict[str, Any] | None:
    """Para la pantalla de suscripción; None si no hay ciclo en curso."""
    ciclo = ciclo_vigente(db, usuario)
    if ciclo is None:
        return None
    return {
        "estado": ciclo.estado.value,
        "inicio": ciclo.inicio,
        "recorte_en": ciclo.recorte_en,
        "id_boveda_conservar": ciclo.id_boveda_conservar,
        "excesos": excedente(db, usuario),
    }


def elegir_boveda_conservar(db: Session, usuario: Usuario, id_boveda: int | None) -> None:
    """El propietario elige qué bóveda se conserva si llega el recorte
    (None = que decida la regla por defecto)."""
    ciclo = ciclo_vigente(db, usuario)
    if ciclo is None:
        raise NoEncontrado("No tienes un plan vencido con contenido por recortar.")
    if id_boveda is not None:
        boveda = db.get(Boveda, id_boveda)
        if boveda is None or boveda.id_propietario != usuario.id:
            raise NoEncontrado("Bóveda no encontrada.")
    ciclo.id_boveda_conservar = id_boveda
    db.flush()


def _cerrar(ciclo: CicloImpago, motivo: MotivoCierreImpago) -> None:
    ciclo.estado = EstadoCicloImpago.cerrado
    ciclo.motivo_cierre = motivo
    ciclo.cerrado_en = ahora().replace(microsecond=0)


def cerrar_por_pago(db: Session, usuario: Usuario) -> None:
    """Volvió a pagar: el ciclo en curso (si hay) se cierra sin recortar."""
    if (ciclo := ciclo_vigente(db, usuario)) is not None:
        _cerrar(ciclo, MotivoCierreImpago.pago)
        db.flush()


# --------------------------------------------------------------------------
# Avisos
# --------------------------------------------------------------------------
def _clave(ciclo: CicloImpago, sufijo: str | int) -> str:
    # La fecha del recorte va en la clave: si se reprograma, los recordatorios
    # vuelven a enviarse para la fecha nueva.
    return f"impago:{ciclo.id}:{ciclo.recorte_en:%Y%m%d}:{sufijo}"


def _avisar_plazo(db: Session, usuario: Usuario, ciclo: CicloImpago, motivo: str) -> bool:
    """motivo: 'inicio' o 'reprogramado' (siempre se envían, una vez por
    fecha de recorte) o 'recordatorio' (solo al alcanzar un umbral)."""
    dias = (ciclo.recorte_en - hoy()).days
    umbral = avisos_plan.umbral_alcanzado(dias, _UMBRALES)
    if motivo == "recordatorio":
        if umbral is None or avisos_plan.ya_enviado(db, usuario, _clave(ciclo, umbral)):
            return False
        avisos_plan.marcar(db, usuario, _clave(ciclo, umbral))
    else:
        if avisos_plan.ya_enviado(db, usuario, _clave(ciclo, motivo)):
            return False
        avisos_plan.marcar(db, usuario, _clave(ciclo, motivo))
        if umbral is not None:  # ya cuenta como el recordatorio de este umbral
            avisos_plan.marcar(db, usuario, _clave(ciclo, umbral))
    avisos_plan.avisar(
        db,
        usuario,
        "plan_impago",
        motivo=motivo,
        dias=dias,
        recorte_en=avisos_plan.fecha(ciclo.recorte_en),
        excesos=excedente(db, usuario),
    )
    return True


# --------------------------------------------------------------------------
# Recorte
# --------------------------------------------------------------------------
def _orden_de_conservacion(db: Session, bovedas: list[Boveda], elegida: int | None) -> list[Boveda]:
    """La elegida primero; después la de más custodios y, a igualdad, la más antigua."""
    custodios = dict(
        db.execute(
            select(CustodioBoveda.id_boveda, func.count(CustodioBoveda.id))
            .where(CustodioBoveda.id_boveda.in_([b.id for b in bovedas]))
            .group_by(CustodioBoveda.id_boveda)
        )
        .tuples()
        .all()
    )
    return sorted(
        bovedas,
        key=lambda b: (
            b.id != elegida,
            -custodios.get(b.id, 0),
            b.created_at or datetime.max,
            b.id,
        ),
    )


def _borrar_activo(db: Session, activo: ActivoDigital) -> None:
    almacenamiento_service.borrar_blob(activo.blob_name)
    db.delete(activo)


def recortar(db: Session, usuario: Usuario, elegida: int | None = None) -> dict[str, list[str]]:
    """Deja el contenido del propietario dentro del plan Gratuito. Devuelve
    los nombres de lo borrado (bóvedas completas y archivos sueltos)."""
    gratis = cuota.plan_gratuito(db)
    borrado: dict[str, list[str]] = {"bovedas": [], "archivos": []}

    bovedas = list(db.scalars(select(Boveda).where(Boveda.id_propietario == usuario.id)))
    orden = _orden_de_conservacion(db, bovedas, elegida)
    conservadas, sobrantes = orden[: gratis.max_bovedas], orden[gratis.max_bovedas :]
    for boveda in sobrantes:
        borrado["bovedas"].append(boveda.nombre)
        boveda_service.purgar_boveda(db, boveda)
    db.flush()

    cuota_bytes = gratis.max_almacenamiento * cuota.GB
    activos = list(
        db.scalars(
            select(ActivoDigital)
            .where(
                ActivoDigital.id_boveda.in_([b.id for b in conservadas]),
                ActivoDigital.estado == EstadoActivo.activo,
            )
            .order_by(ActivoDigital.created_at.desc(), ActivoDigital.id.desc())
        )
    )
    # Primero lo que nunca cabría (un solo archivo mayor que la cuota) y
    # después los más recientes, hasta quedar dentro.
    total = sum(a.tamano_cifrado for a in activos)
    for activo in [a for a in activos if a.tamano_cifrado > cuota_bytes] + [
        a for a in activos if a.tamano_cifrado <= cuota_bytes
    ]:
        if total <= cuota_bytes:
            break
        total -= activo.tamano_cifrado
        borrado["archivos"].append(activo.nombre_original)
        _borrar_activo(db, activo)
    db.flush()
    return borrado


# --------------------------------------------------------------------------
# Barrido periódico
# --------------------------------------------------------------------------
def _fines_de_pago(db: Session, dia: date) -> list[tuple[int, date]]:
    """(propietario, día en que terminó su última cobertura de pago) de
    quienes tuvieron alguna y ya terminó."""
    return [
        (id_prop, fin)
        for id_prop, fin in db.execute(
            select(
                PropietarioSuscripcion.id_propietario, func.max(PropietarioSuscripcion.fecha_fin)
            )
            .join(Suscripcion, Suscripcion.id == PropietarioSuscripcion.id_suscripcion)
            .where(Suscripcion.costo_anual > 0, PropietarioSuscripcion.fecha_fin <= dia)
            .group_by(PropietarioSuscripcion.id_propietario)
        ).all()
    ]


def _abrir_ciclos(db: Session, dia: date) -> int:
    """Un ciclo por cada fin de cobertura de pago que aún no tiene uno."""
    abiertos = 0
    for id_prop, fin in _fines_de_pago(db, dia):
        ya_existe = db.scalar(
            select(CicloImpago.id).where(
                CicloImpago.id_propietario == id_prop, CicloImpago.inicio == fin
            )
        )
        if ya_existe is not None:
            continue
        usuario = db.get(Usuario, id_prop)
        if usuario is None or usuario.propietario is None:
            continue
        if cuota.plan_vigente(db, usuario).costo_anual > 0:
            continue  # volvió a pagar después de ese fin

        ciclo = CicloImpago(
            id_propietario=id_prop,
            inicio=fin,
            # Aunque el barrido se haya retrasado, nunca menos que el plazo de reprogramación.
            recorte_en=max(
                fin + timedelta(days=settings.IMPAGO_PLAZO_DIAS),
                dia + timedelta(days=settings.IMPAGO_REPROGRAMACION_DIAS),
            ),
            estado=EstadoCicloImpago.abierto,
        )
        db.add(ciclo)
        motivo_dms = _CIERRE_POR_DMS.get(usuario.propietario.status_dms)
        if motivo_dms is not None:
            _cerrar(ciclo, motivo_dms)
        elif not excedente(db, usuario):
            _cerrar(ciclo, MotivoCierreImpago.sin_exceso)
        else:
            abiertos += 1
            db.flush()  # id para las claves de aviso
            if usuario.propietario.status_dms in _PAUSA:
                ciclo.estado = EstadoCicloImpago.pausado
            else:
                _avisar_plazo(db, usuario, ciclo, "inicio")
        db.commit()
    return abiertos


def _evaluar(db: Session, ciclo: CicloImpago, dia: date) -> str | None:
    """Avanza un ciclo en curso. Devuelve qué pasó (para el registro) o None."""
    usuario = db.get(Usuario, ciclo.id_propietario)
    assert usuario is not None and usuario.propietario is not None
    status = usuario.propietario.status_dms

    if cuota.plan_vigente(db, usuario).costo_anual > 0:
        _cerrar(ciclo, MotivoCierreImpago.pago)
        return "pagados"
    if (motivo := _CIERRE_POR_DMS.get(status)) is not None:
        _cerrar(ciclo, motivo)
        return "liberados" if motivo == MotivoCierreImpago.liberado else "cuentas"
    if status in _PAUSA:
        if ciclo.estado == EstadoCicloImpago.pausado:
            return None
        ciclo.estado = EstadoCicloImpago.pausado
        return "pausados"

    resultado = None
    if ciclo.estado == EstadoCicloImpago.pausado:
        # Confirmó que vive: se reanuda con al menos el plazo de reprogramación.
        ciclo.estado = EstadoCicloImpago.abierto
        minimo = dia + timedelta(days=settings.IMPAGO_REPROGRAMACION_DIAS)
        if ciclo.recorte_en < minimo:
            ciclo.recorte_en = minimo
        _avisar_plazo(db, usuario, ciclo, "reprogramado")
        resultado = "reanudados"

    if not excedente(db, usuario):
        _cerrar(ciclo, MotivoCierreImpago.sin_exceso)
        return "sin_exceso"
    if dia < ciclo.recorte_en:
        if _avisar_plazo(db, usuario, ciclo, "recordatorio"):
            resultado = resultado or "avisados"
        return resultado

    borrado = recortar(db, usuario, ciclo.id_boveda_conservar)
    _cerrar(ciclo, MotivoCierreImpago.recorte)
    avisos_plan.avisar(db, usuario, "plan_recorte", **borrado)
    return "recortados"


def procesar_impago(db: Session) -> dict[str, int]:
    """Paso del barrido: abre los ciclos de quien terminó su cobertura de
    pago y avanza los que están en curso. Confirma por ciclo: el recorte
    borra blobs, que no se pueden revertir junto con la transacción."""
    dia = hoy()
    cambios: dict[str, int] = {"abiertos": _abrir_ciclos(db, dia)}
    en_curso = db.scalars(
        select(CicloImpago.id).where(CicloImpago.estado != EstadoCicloImpago.cerrado)
    ).all()
    for id_ciclo in en_curso:
        ciclo = db.get(CicloImpago, id_ciclo)
        assert ciclo is not None
        if (resultado := _evaluar(db, ciclo, dia)) is not None:
            cambios[resultado] = cambios.get(resultado, 0) + 1
        db.commit()
    return {k: v for k, v in cambios.items() if v}
