# backend/app/services/suscripcion_service.py
"""
Suscripciones: catálogo de planes, plan activo del propietario y cambio de plan.

`aplicar_cambio` cierra la fila vigente de `propietario_suscripcion`
(fecha_fin = hoy) y abre otra apuntando al nuevo plan; surte efecto de
inmediato. Los cambios que requieren pago (ver `requiere_pago`) solo se
aplican tras capturar una orden de PayPal válida (`capturar_pago`); si
PayPal no está configurado, se permite el "pago simulado" por /cambiar.

Un plan de pago dura un año (fecha_fin = fecha_inicio + 1 año) y no se
renueva solo: al contratarlo se agenda el Gratuito que lo sucede, y para
seguir en él hay que volver a pagarlo. Cancelar (`cancelar`) no lo quita:
solo marca que no se renovará, y sigue vigente hasta fecha_fin.
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tiempo import ahora, hoy, utc
from app.models.boveda import Boveda
from app.models.custodio import Custodio
from app.models.suscripcion import PropietarioSuscripcion, Suscripcion
from app.models.usuario import Usuario
from app.services import cuota, paypal_service
from app.services.errores import Conflicto, DatoInvalido, NoEncontrado

# reference_id que se manda al crear la orden: plan-<id>-anual (el único
# ciclo). La captura no confía en lo que declara la orden: una orden de PayPal
# real y aprobada con cualquier otra referencia — p. ej. "...-mensual", forjada
# fuera de nuestro /checkout — se rechaza aquí.
_REFERENCIA_RE = re.compile(r"^plan-(\d+)-anual$")


class PlanNoEncontrado(NoEncontrado):
    """El plan solicitado no existe en el catálogo."""


class PlanConflicto(Conflicto):
    """El cambio de plan no es válido (ya lo tienes, o el uso actual lo excede)."""


# --------------------------------------------------------------------------
# Lectura
# --------------------------------------------------------------------------
def _plan_a_dict(s: Suscripcion) -> dict[str, Any]:
    return {
        "id": s.id,
        "nombre": s.nombre,
        "costo_anual": float(s.costo_anual),
        "max_almacenamiento_gb": s.max_almacenamiento,
        "max_bovedas": s.max_bovedas,
        "max_custodios": s.max_custodios,
    }


def listar_planes(db: Session) -> list[dict[str, Any]]:
    planes = (
        db.query(Suscripcion).order_by(Suscripcion.costo_anual.asc(), Suscripcion.id.asc()).all()
    )
    return [_plan_a_dict(p) for p in planes]


def _num_bovedas(db: Session, usuario: Usuario) -> int:
    total = db.query(func.count(Boveda.id)).filter(Boveda.id_propietario == usuario.id).scalar()
    return int(total or 0)


def _num_custodios(db: Session, usuario: Usuario) -> int:
    total = db.query(func.count(Custodio.id)).filter(Custodio.id_propietario == usuario.id).scalar()
    return int(total or 0)


def _uso_actual(db: Session, usuario: Usuario) -> dict[str, int]:
    """Forma de UsoActual: consumo real para compararlo con los límites del plan."""
    return {
        "bovedas": _num_bovedas(db, usuario),
        "custodios": _num_custodios(db, usuario),
        "almacenamiento_bytes": cuota.uso_bytes(db, usuario),
    }


def obtener_estado(db: Session, usuario: Usuario) -> dict[str, Any]:
    """Plan vigente + fechas + consumo real."""
    vigente = cuota.suscripcion_activa(db, usuario)
    return {
        "plan": _plan_a_dict(vigente.suscripcion),
        "fecha_inicio": vigente.fecha_inicio,
        "fecha_fin": vigente.fecha_fin,
        "cancelada_en": utc(vigente.cancelada_en),
        "uso": _uso_actual(db, usuario),
    }


# --------------------------------------------------------------------------
# Escritura
# --------------------------------------------------------------------------
def _excesos(uso: dict[str, int], plan: Suscripcion) -> list[str]:
    """Qué parte del uso actual no cabe en `plan` (vacía si todo cabe)."""
    problemas = []
    if uso["bovedas"] > plan.max_bovedas:
        problemas.append(f"{uso['bovedas']} bóvedas (el plan permite {plan.max_bovedas})")
    if uso["custodios"] > plan.max_custodios:
        problemas.append(f"{uso['custodios']} custodios (el plan permite {plan.max_custodios})")
    if uso["almacenamiento_bytes"] > plan.max_almacenamiento * cuota.GB:
        usados_gb = uso["almacenamiento_bytes"] / cuota.GB
        problemas.append(
            f"{usados_gb:.2f} GB usados (el plan permite {plan.max_almacenamiento} GB)"
        )
    return problemas


def validar_cambio(db: Session, usuario: Usuario, id_plan: int) -> Suscripcion:
    """Comprueba que el propietario PUEDE cambiar a `id_plan` (existe, no es
    el que ya tiene, y su uso actual cabe en los límites). Devuelve el plan
    destino. No modifica nada."""
    destino = db.get(Suscripcion, id_plan)
    if destino is None:
        raise PlanNoEncontrado("El plan solicitado no existe.")

    if cuota.suscripcion_activa(db, usuario).id_suscripcion == id_plan:
        raise PlanConflicto("Ya tienes este plan activo.")

    excesos = _excesos(_uso_actual(db, usuario), destino)
    if excesos:
        raise PlanConflicto(
            "No puedes cambiar a este plan: tu uso actual lo excede — "
            + "; ".join(excesos)
            + ". Libera recursos e inténtalo de nuevo."
        )
    return destino


def requiere_pago(db: Session, usuario: Usuario, destino: Suscripcion) -> bool:
    """
    Mismo criterio que el frontend (Suscripcion.tsx, `requierePago`): hay que
    pasar por caja si el plan cuesta algo y NO es una bajada de nivel respecto
    al plan vigente.
    """
    if destino.costo_anual <= 0:
        return False
    es_bajada = destino.costo_anual < cuota.plan_vigente(db, usuario).costo_anual
    return not es_bajada


def _un_anio_despues(dia: date) -> date:
    """Mismo día del año siguiente (fin de la vigencia de un plan de pago)."""
    try:
        return dia.replace(year=dia.year + 1)
    except ValueError:  # 29 de febrero -> 28 (igual que DATE_ADD ... INTERVAL 1 YEAR)
        return dia.replace(year=dia.year + 1, day=28)


def aplicar_cambio(
    db: Session,
    usuario: Usuario,
    id_plan: int,
    paypal_order_id: str | None = None,
) -> dict[str, Any]:
    """Cierra la suscripción vigente y abre la nueva desde hoy. Si es de pago,
    dura un año y se agenda el Gratuito que la sucede. Asume que
    `validar_cambio` ya pasó (y, si aplica, que el pago fue confirmado)."""
    dia = hoy()
    actual = cuota.suscripcion_activa(db, usuario)
    actual.fecha_fin = dia
    # Lo agendado tras la contratación que se cierra (su Gratuito) ya no aplica.
    db.query(PropietarioSuscripcion).filter(
        PropietarioSuscripcion.id_propietario == usuario.id,
        PropietarioSuscripcion.fecha_inicio > dia,
    ).delete()

    plan = db.get(Suscripcion, id_plan)
    fin = _un_anio_despues(dia) if plan is not None and plan.costo_anual > 0 else None
    db.add(
        PropietarioSuscripcion(
            id_propietario=usuario.id,
            id_suscripcion=id_plan,
            fecha_inicio=dia,
            fecha_fin=fin,
            paypal_order_id=paypal_order_id,
        )
    )
    if fin is not None:
        db.add(
            PropietarioSuscripcion(
                id_propietario=usuario.id,
                id_suscripcion=cuota.ID_PLAN_GRATUITO,
                fecha_inicio=fin,
                fecha_fin=None,
            )
        )
    try:
        db.flush()
    except IntegrityError:
        # Dos capturas concurrentes de la misma orden: gana la primera (la
        # unidad de trabajo revierte el resto al propagarse el error).
        raise PlanConflicto("Esta orden de pago ya fue utilizada.") from None
    return obtener_estado(db, usuario)


def cambiar_plan(db: Session, usuario: Usuario, id_plan: int) -> dict[str, Any]:
    """Cambio directo, sin pasarela: planes sin costo o el modo 'simular pago'
    cuando PayPal no está configurado. Cualquier otro cambio debe pasar por
    `iniciar_pago` / `capturar_pago`. Bajar desde un plan de pago no es un
    cambio directo: se cancela (lo pagado sigue vigente hasta fecha_fin)."""
    vigente = cuota.suscripcion_activa(db, usuario)
    destino = db.get(Suscripcion, id_plan)
    if destino is not None and destino.costo_anual < vigente.suscripcion.costo_anual:
        # El vigente es de pago (cuesta más que el destino): siempre tiene fecha_fin.
        raise PlanConflicto(
            f"Para dejar tu plan {vigente.suscripcion.nombre}, cancélalo: lo conservas hasta"
            f" que venza el {vigente.fecha_fin:%d/%m/%Y} y después pasas a Gratuito."
        )

    destino = validar_cambio(db, usuario, id_plan)
    if requiere_pago(db, usuario, destino) and paypal_service.esta_configurado():
        raise PlanConflicto("Este cambio de plan requiere pago; complétalo con PayPal.")
    return aplicar_cambio(db, usuario, id_plan)


def _vigente_de_pago(db: Session, usuario: Usuario) -> PropietarioSuscripcion:
    vigente = cuota.suscripcion_activa(db, usuario)
    if vigente.suscripcion.costo_anual <= 0:
        raise PlanConflicto("No tienes un plan de pago vigente.")
    return vigente


def cancelar(db: Session, usuario: Usuario) -> dict[str, Any]:
    """El propietario no renovará: el plan de pago sigue vigente hasta
    `fecha_fin` y después pasa a Gratuito (ya agendado al contratarlo).
    Idempotente."""
    vigente = _vigente_de_pago(db, usuario)
    if vigente.cancelada_en is None:
        # DATETIME guarda segundos: así la respuesta coincide con lo que se relee
        vigente.cancelada_en = ahora().replace(microsecond=0)
        db.flush()
    return obtener_estado(db, usuario)


def reactivar(db: Session, usuario: Usuario) -> dict[str, Any]:
    """Deshace la cancelación mientras el plan siga vigente. Idempotente."""
    vigente = _vigente_de_pago(db, usuario)
    vigente.cancelada_en = None
    db.flush()
    return obtener_estado(db, usuario)


# --------------------------------------------------------------------------
# Pago con PayPal (Orders v2): iniciar -> el comprador aprueba -> capturar
# --------------------------------------------------------------------------
def iniciar_pago(db: Session, usuario: Usuario, id_plan: int) -> dict[str, Any]:
    """Valida el cambio y crea la orden por el importe anual del plan. La
    orden queda ligada a este propietario (`custom_id`) y al plan
    (`reference_id`); ambos se verifican al capturar."""
    plan = validar_cambio(db, usuario, id_plan)
    if not requiere_pago(db, usuario, plan):
        raise PlanConflicto("Este cambio de plan no requiere pago; usa /cambiar.")
    orden = paypal_service.crear_orden(
        amount=f"{plan.costo_anual:.2f}",
        currency=settings.PAYPAL_CURRENCY,
        reference_id=f"plan-{plan.id}-anual",
        custom_id=f"u{usuario.id}",
        description=f"B152 · Plan {plan.nombre} (anual)",
    )
    return {"order_id": orden["id"], "status": orden.get("status", "CREATED")}


def _importe(unidad: dict[str, Any]) -> tuple[Decimal | None, str | None]:
    """(valor, moneda) que declara la unidad de compra de la orden."""
    amount = unidad.get("amount") or {}
    try:
        valor = Decimal(str(amount.get("value")))
    except (InvalidOperation, TypeError):
        valor = None
    return valor, amount.get("currency_code")


def capturar_pago(db: Session, usuario: Usuario, order_id: str) -> dict[str, Any]:
    """
    Tras la aprobación del comprador: captura la orden y aplica el cambio.
    Nada de la orden se toma a ciegas — el plan destino sale del
    `reference_id`, y además se exige que:
      - la orden sea de este propietario (`custom_id`),
      - el importe y la moneda coincidan con el precio vigente del plan
        (una orden creada del lado del cliente con el client-id público
        podría declarar cualquier importe),
      - la orden no se haya usado antes (UNIQUE en `paypal_order_id`).
    """
    if not paypal_service.order_id_valido(order_id):
        raise DatoInvalido("Identificador de orden de PayPal inválido.")
    ya_usada = (
        db.query(PropietarioSuscripcion)
        .filter(PropietarioSuscripcion.paypal_order_id == order_id)
        .first()
    )
    if ya_usada is not None:
        if ya_usada.id_propietario == usuario.id:
            return obtener_estado(db, usuario)  # reintento del mismo pago: idempotente
        raise PlanConflicto("Esta orden de pago ya fue utilizada.")

    orden = paypal_service.obtener_orden(order_id)
    unidad = paypal_service.unidad_de_compra(orden) or {}

    coincidencia = _REFERENCIA_RE.match(unidad.get("reference_id") or "")
    if coincidencia is None:
        raise PlanConflicto("La orden no corresponde a un cambio de plan.")
    if unidad.get("custom_id") != f"u{usuario.id}":
        raise PlanConflicto("La orden de pago no pertenece a tu cuenta.")
    id_plan = int(coincidencia.group(1))

    # Se revalida contra el estado actual (pudo cambiar entre iniciar y capturar).
    plan = validar_cambio(db, usuario, id_plan)
    valor, moneda = _importe(unidad)
    if moneda != settings.PAYPAL_CURRENCY or valor != Decimal(f"{plan.costo_anual:.2f}"):
        raise PlanConflicto("El importe de la orden no corresponde al precio del plan.")

    estado = orden.get("status")
    if estado == "APPROVED":
        captura = paypal_service.capturar_orden(order_id)
        if captura.get("status") != "COMPLETED":
            raise paypal_service.ErrorPayPal(
                f"El pago no se completó (estado {captura.get('status')})."
            )
    elif estado != "COMPLETED":
        raise paypal_service.ErrorPayPal(f"El pago no fue aprobado (estado {estado}).")

    return aplicar_cambio(db, usuario, id_plan, paypal_order_id=order_id)


# --------------------------------------------------------------------------
# Guardas de límites (usadas por boveda_service / custodio_service)
# --------------------------------------------------------------------------
def exigir_cupo_boveda(db: Session, usuario: Usuario) -> None:
    """409 si crear otra bóveda excede el plan vigente."""
    plan = cuota.plan_vigente(db, usuario)
    if _num_bovedas(db, usuario) >= plan.max_bovedas:
        raise PlanConflicto(
            f"Alcanzaste el límite de {plan.max_bovedas} bóveda(s) de tu plan «{plan.nombre}». "
            "Sube de plan para crear más."
        )


def exigir_cupo_custodio(db: Session, usuario: Usuario) -> None:
    """409 si registrar otro custodio excede el plan vigente."""
    plan = cuota.plan_vigente(db, usuario)
    if _num_custodios(db, usuario) >= plan.max_custodios:
        raise PlanConflicto(
            f"Alcanzaste el límite de {plan.max_custodios} custodio(s) de tu plan «{plan.nombre}». "
            "Sube de plan para registrar más."
        )
