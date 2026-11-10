# backend/app/services/suscripcion_service.py
"""
Suscripciones: catálogo, cobertura del propietario, compras (plan anual y
año de reserva), renovación y avisos.

Línea de tiempo
---------------
Cada fila de `propietario_suscripcion` es un periodo [fecha_inicio, fecha_fin)
y la que cubre hoy decide los límites (`cuota.suscripcion_activa`). Al pagar
un año se agenda de una vez todo lo que le sigue (`_agendar_cola`):

    sin año de reserva:   [pagado 1 año] → [Gratuito …]
    con año de reserva:   [pagado 1 año] → [gracia 30 d] → [reserva hasta 12 meses] → [Gratuito …]

Así la cobertura depende solo de fechas: el barrido no tiene que "extender"
nada a tiempo, solo marcar la reserva como activa o consumida y avisar.

La renovación es manual (no hay cobro recurrente): se paga otra vez el plan,
desde RENOVACION_VENTANA_DIAS antes de vencer, y el año nuevo empieza:
    - en la fecha de vencimiento, si aún está vigente o en la gracia
      (no pierde días y la reserva queda intacta);
    - hoy, si ya lo cubre la reserva (la reserva se gasta) o el Gratuito.

Cancelar solo apaga los avisos de renovación. Lo que pasa con el contenido
que excede el Gratuito al terminar la cobertura está en services/impago.py.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tiempo import ahora, hoy, utc
from app.models.suscripcion import (
    EstadoReserva,
    OrigenCobertura,
    PropietarioSuscripcion,
    ReservaContinuidad,
    Suscripcion,
)
from app.models.usuario import Propietario, Usuario
from app.services import avisos_plan, cuota, impago, paypal_service
from app.services.errores import DatoInvalido, NoEncontrado

PlanConflicto = cuota.PlanConflicto  # la API lo sigue importando de aquí

# reference_id de la orden: compra-p<plan>-a<1 si incluye el año del plan>-r<1
# si incluye el año de reserva>. La captura no confía en lo que declara la
# orden: lo vuelve a planear con el estado actual y exige el mismo importe.
_REFERENCIA_RE = re.compile(r"^compra-p(\d+)-a([01])-r([01])$")
_UMBRALES_RENOVACION = (30, 7, 1)


class PlanNoEncontrado(NoEncontrado):
    """El plan solicitado no existe en el catálogo."""


class Cobertura:
    """Qué cubre hoy al propietario (para la API y el frontend)."""

    gratuito = "gratuito"
    pago = "pago"  # año pagado vigente
    gracia = "gracia"  # venció; con año de reserva aún puede renovar sin gastarla
    reserva = "reserva"  # lo cubre el año de reserva


# --------------------------------------------------------------------------
# Consultas sobre la línea de tiempo
# --------------------------------------------------------------------------
def _un_anio_despues(dia: date) -> date:
    """Mismo día del año siguiente (29 de febrero -> 28, como DATE_ADD ... INTERVAL 1 YEAR)."""
    try:
        return dia.replace(year=dia.year + 1)
    except ValueError:
        return dia.replace(year=dia.year + 1, day=28)


def _cobertura(vigente: PropietarioSuscripcion) -> str:
    if not vigente.es_de_pago:
        return Cobertura.gratuito
    return {
        OrigenCobertura.contratado: Cobertura.pago,
        OrigenCobertura.gracia: Cobertura.gracia,
        OrigenCobertura.reserva: Cobertura.reserva,
    }[vigente.origen]


def _ultimo_pagado(db: Session, usuario: Usuario) -> PropietarioSuscripcion | None:
    """Último año pagado que aún no termina (el vigente o una renovación ya
    agendada después de él)."""
    return db.scalars(
        select(PropietarioSuscripcion)
        .join(Suscripcion)
        .where(
            PropietarioSuscripcion.id_propietario == usuario.id,
            PropietarioSuscripcion.origen == OrigenCobertura.contratado,
            Suscripcion.costo_anual > 0,
            PropietarioSuscripcion.fecha_fin > hoy(),
        )
        .order_by(PropietarioSuscripcion.fecha_inicio.desc(), PropietarioSuscripcion.id.desc())
        .limit(1)
    ).first()


def _reserva_pendiente(db: Session, usuario: Usuario) -> ReservaContinuidad | None:
    """El año de reserva sin consumir (como mucho hay uno)."""
    return db.scalars(
        select(ReservaContinuidad)
        .where(
            ReservaContinuidad.id_propietario == usuario.id,
            ReservaContinuidad.estado != EstadoReserva.consumida,
        )
        .order_by(ReservaContinuidad.id.desc())
        .limit(1)
    ).first()


def _periodo_de_reserva(
    db: Session, reserva: ReservaContinuidad, *, solo_iniciado: bool = False
) -> PropietarioSuscripcion | None:
    """El periodo 'reserva' que corresponde a este año de reserva: el primero
    agendado desde que se compró (los anteriores son de reservas ya
    consumidas). Con `solo_iniciado`, solo si ya empezó."""
    consulta = select(PropietarioSuscripcion).where(
        PropietarioSuscripcion.id_propietario == reserva.id_propietario,
        PropietarioSuscripcion.origen == OrigenCobertura.reserva,
        PropietarioSuscripcion.fecha_inicio >= reserva.comprada_en.date(),
    )
    if solo_iniciado:
        consulta = consulta.where(PropietarioSuscripcion.fecha_inicio <= hoy())
    return db.scalars(consulta.order_by(PropietarioSuscripcion.fecha_inicio.asc()).limit(1)).first()


# --------------------------------------------------------------------------
# Escritura de la línea de tiempo
# --------------------------------------------------------------------------
def _liberar_desde(db: Session, usuario: Usuario, dia: date) -> None:
    """Deja la línea de tiempo libre a partir de `dia`: borra lo agendado
    desde ese día y cierra en `dia` el periodo que lo atraviesa."""
    periodos = db.scalars(
        select(PropietarioSuscripcion).where(PropietarioSuscripcion.id_propietario == usuario.id)
    ).all()
    for periodo in periodos:
        if periodo.fecha_inicio >= dia:
            db.delete(periodo)
        elif periodo.fecha_fin is None or periodo.fecha_fin > dia:
            periodo.fecha_fin = dia
    db.flush()


def _agendar_cola(db: Session, usuario: Usuario, plan: Suscripcion, fin: date) -> None:
    """Lo que sigue a un año pagado de `plan` que termina en `fin`: la gracia
    y la reserva si tiene un año de reserva disponible, y después el Gratuito."""
    _liberar_desde(db, usuario, fin)
    reserva = _reserva_pendiente(db, usuario)
    con_reserva = reserva is not None and reserva.estado == EstadoReserva.disponible
    if plan.costo_reserva > 0 and con_reserva:
        fin_gracia = fin + timedelta(days=settings.RESERVA_GRACIA_DIAS)
        fin_reserva = _un_anio_despues(fin)  # 12 meses desde el vencimiento
        for inicio, termina, origen in (
            (fin, fin_gracia, OrigenCobertura.gracia),
            (fin_gracia, fin_reserva, OrigenCobertura.reserva),
        ):
            db.add(
                PropietarioSuscripcion(
                    id_propietario=usuario.id,
                    id_suscripcion=plan.id,
                    fecha_inicio=inicio,
                    fecha_fin=termina,
                    origen=origen,
                )
            )
        fin = fin_reserva
    db.add(
        PropietarioSuscripcion(
            id_propietario=usuario.id,
            id_suscripcion=cuota.ID_PLAN_GRATUITO,
            fecha_inicio=fin,
            fecha_fin=None,
        )
    )
    db.flush()


def _abrir_anio(
    db: Session,
    usuario: Usuario,
    plan: Suscripcion,
    inicio: date,
    paypal_order_id: str | None = None,
) -> None:
    """Un año pagado de `plan` desde `inicio`, más lo que le sigue."""
    _liberar_desde(db, usuario, inicio)
    fin = _un_anio_despues(inicio)
    db.add(
        PropietarioSuscripcion(
            id_propietario=usuario.id,
            id_suscripcion=plan.id,
            fecha_inicio=inicio,
            fecha_fin=fin,
            paypal_order_id=paypal_order_id,
        )
    )
    db.flush()
    _agendar_cola(db, usuario, plan, fin)
    impago.cerrar_por_pago(db, usuario)


# --------------------------------------------------------------------------
# Lectura
# --------------------------------------------------------------------------
def _plan_a_dict(s: Suscripcion) -> dict[str, Any]:
    return {
        "id": s.id,
        "nombre": s.nombre,
        "costo_anual": float(s.costo_anual),
        "costo_reserva": float(s.costo_reserva),
        "max_almacenamiento_gb": s.max_almacenamiento,
        "max_bovedas": s.max_bovedas,
        "max_custodios": s.max_custodios,
    }


def listar_planes(db: Session) -> list[dict[str, Any]]:
    planes = db.scalars(
        select(Suscripcion).order_by(Suscripcion.costo_anual.asc(), Suscripcion.id.asc())
    ).all()
    return [_plan_a_dict(p) for p in planes]


def _renovacion(
    vigente: PropietarioSuscripcion, ultimo: PropietarioSuscripcion | None, cobertura: str
) -> tuple[bool, date | None]:
    """(¿puede pagar el plan hoy?, desde cuándo podrá renovar si aún no)."""
    if cobertura != Cobertura.pago:
        return True, None  # gratuito: contratar; gracia/reserva: renovar ya
    if ultimo is not None and ultimo.id != vigente.id:
        return False, None  # ya renovó
    assert vigente.fecha_fin is not None  # un año pagado siempre termina
    desde = vigente.fecha_fin - timedelta(days=settings.RENOVACION_VENTANA_DIAS)
    return hoy() >= desde, desde


def obtener_estado(db: Session, usuario: Usuario) -> dict[str, Any]:
    """Plan y cobertura de hoy, consumo, renovación, año de reserva e impago."""
    vigente = cuota.suscripcion_activa(db, usuario)
    cobertura = _cobertura(vigente)
    ultimo = _ultimo_pagado(db, usuario)
    puede_renovar, renovable_desde = _renovacion(vigente, ultimo, cobertura)

    reserva = _reserva_pendiente(db, usuario)
    estado_reserva = None
    if reserva is not None:
        periodo = _periodo_de_reserva(db, reserva)
        estado_reserva = {
            "estado": reserva.estado.value,
            "cubre_desde": periodo.fecha_inicio if periodo else None,
            "cubre_hasta": periodo.fecha_fin if periodo else None,
        }

    return {
        "plan": _plan_a_dict(vigente.suscripcion),
        "fecha_inicio": vigente.fecha_inicio,
        "fecha_fin": vigente.fecha_fin,
        "cancelada_en": utc(vigente.cancelada_en) if cobertura == Cobertura.pago else None,
        "uso": cuota.uso_actual(db, usuario),
        "cobertura": cobertura,
        "pagado_hasta": ultimo.fecha_fin if ultimo else None,
        "puede_renovar": puede_renovar,
        "renovable_desde": renovable_desde,
        "reserva": estado_reserva,
        "impago": impago.estado(db, usuario),
    }


# --------------------------------------------------------------------------
# Compras: plan anual, año de reserva, o ambos en una sola orden
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Compra:
    """Qué se cobra y cómo queda la línea de tiempo, calculado con el estado
    actual. Se planea al crear la orden y otra vez al capturarla."""

    plan: Suscripcion
    incluye_plan: bool
    incluye_reserva: bool
    inicio: date | None  # desde cuándo cuenta el año pagado (None si solo es la reserva)
    gasta_reserva: ReservaContinuidad | None  # reserva que cubre hoy y se pierde al pagar

    @property
    def importe(self) -> Decimal:
        total = Decimal("0")
        if self.incluye_plan:
            total += self.plan.costo_anual
        if self.incluye_reserva:
            total += self.plan.costo_reserva
        return total.quantize(Decimal("0.01"))

    @property
    def referencia(self) -> str:
        return f"compra-p{self.plan.id}-a{int(self.incluye_plan)}-r{int(self.incluye_reserva)}"

    @property
    def descripcion(self) -> str:
        partes = [f"Plan {self.plan.nombre} (1 año)"] if self.incluye_plan else []
        if self.incluye_reserva:
            partes.append("Año de reserva")
        return f"{settings.MARCA} · " + " + ".join(partes)


def _planear_anio(
    db: Session, usuario: Usuario, plan: Suscripcion, vigente: PropietarioSuscripcion
) -> tuple[date, ReservaContinuidad | None]:
    """Desde cuándo contaría un año más de `plan` y si gasta la reserva."""
    cobertura = _cobertura(vigente)
    if cobertura == Cobertura.gratuito:
        excesos = cuota.excesos(cuota.uso_actual(db, usuario), plan)
        if excesos:
            raise PlanConflicto(
                "Tu uso actual excede este plan — " + "; ".join(excesos) + ". Libera recursos."
            )
        return hoy(), None

    if vigente.id_suscripcion != plan.id:
        raise PlanConflicto(
            f"Tu cobertura actual es del plan {vigente.suscripcion.nombre}: solo puedes renovarlo."
        )
    if cobertura == Cobertura.pago:
        puede, desde = _renovacion(vigente, _ultimo_pagado(db, usuario), cobertura)
        if not puede:
            if desde is None:
                raise PlanConflicto("Ya renovaste tu plan para el próximo año.")
            raise PlanConflicto(f"Podrás renovar a partir del {avisos_plan.fecha(desde)}.")
        assert vigente.fecha_fin is not None
        return vigente.fecha_fin, None
    if cobertura == Cobertura.gracia:
        return vigente.fecha_inicio, None  # el año cuenta desde el vencimiento
    return hoy(), _reserva_pendiente(db, usuario)  # reserva: empieza hoy y la gasta


def planear_compra(
    db: Session, usuario: Usuario, id_plan: int, incluye_plan: bool, incluye_reserva: bool
) -> Compra:
    """Valida la compra contra el estado actual. No modifica nada."""
    if not (incluye_plan or incluye_reserva):
        raise DatoInvalido("Elige el plan, el año de reserva o ambos.")
    plan = db.get(Suscripcion, id_plan)
    if plan is None:
        raise PlanNoEncontrado("El plan solicitado no existe.")
    if plan.costo_anual <= 0:
        raise PlanConflicto("El plan Gratuito no se compra: es el que queda al terminar un plan.")

    vigente = cuota.suscripcion_activa(db, usuario)
    inicio, gasta = _planear_anio(db, usuario, plan, vigente) if incluye_plan else (None, None)

    if incluye_reserva:
        if plan.costo_reserva <= 0:
            raise PlanConflicto(f"El plan {plan.nombre} no ofrece año de reserva.")
        pendiente = _reserva_pendiente(db, usuario)
        if pendiente is not None and pendiente is not gasta:
            raise PlanConflicto("Ya tienes un año de reserva; podrás comprar otro cuando se use.")
        if not incluye_plan and not (
            _cobertura(vigente) == Cobertura.pago and vigente.id_suscripcion == plan.id
        ):
            raise PlanConflicto(
                "El año de reserva se compra junto con el plan o mientras tu plan está vigente."
            )
    return Compra(plan, incluye_plan, incluye_reserva, inicio, gasta)


def _aplicar_compra(
    db: Session, usuario: Usuario, compra: Compra, paypal_order_id: str | None = None
) -> dict[str, Any]:
    if compra.gasta_reserva is not None:
        reserva = compra.gasta_reserva
        reserva.estado = EstadoReserva.consumida
        reserva.activada_en = reserva.activada_en or hoy()
        reserva.consumida_en = hoy()
    if compra.incluye_reserva:
        db.add(
            ReservaContinuidad(
                id_propietario=usuario.id,
                estado=EstadoReserva.disponible,
                comprada_en=ahora().replace(microsecond=0),
                paypal_order_id=paypal_order_id,
            )
        )
    try:
        db.flush()
        if compra.incluye_plan:
            assert compra.inicio is not None
            _abrir_anio(db, usuario, compra.plan, compra.inicio, paypal_order_id)
        else:
            ultimo = _ultimo_pagado(db, usuario)
            assert ultimo is not None and ultimo.fecha_fin is not None  # lo exigió planear_compra
            _agendar_cola(db, usuario, compra.plan, ultimo.fecha_fin)
    except IntegrityError:
        # Dos capturas concurrentes de la misma orden: gana la primera (la
        # unidad de trabajo revierte el resto al propagarse el error).
        raise PlanConflicto("Esta orden de pago ya fue utilizada.") from None
    return obtener_estado(db, usuario)


def comprar_simulado(
    db: Session, usuario: Usuario, id_plan: int, incluye_plan: bool, incluye_reserva: bool
) -> dict[str, Any]:
    """Compra sin pasarela, solo cuando PayPal no está configurado (pruebas
    y demostración). Con PayPal configurado se paga por /checkout."""
    if paypal_service.esta_configurado():
        raise PlanConflicto("Esta compra requiere pago; complétala con PayPal.")
    compra = planear_compra(db, usuario, id_plan, incluye_plan, incluye_reserva)
    return _aplicar_compra(db, usuario, compra)


def iniciar_pago(
    db: Session, usuario: Usuario, id_plan: int, incluye_plan: bool, incluye_reserva: bool
) -> dict[str, Any]:
    """Valida la compra y crea la orden de PayPal por su importe. La orden
    queda ligada a este propietario (`custom_id`) y a la compra
    (`reference_id`); ambos se verifican al capturar."""
    compra = planear_compra(db, usuario, id_plan, incluye_plan, incluye_reserva)
    orden = paypal_service.crear_orden(
        amount=f"{compra.importe:.2f}",
        currency=settings.PAYPAL_CURRENCY,
        reference_id=compra.referencia,
        custom_id=f"u{usuario.id}",
        description=compra.descripcion,
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


def _orden_usada_por(db: Session, order_id: str) -> int | None:
    """Propietario que ya usó esta orden (en un año pagado o en una reserva)."""
    for modelo in (PropietarioSuscripcion, ReservaContinuidad):
        dueno = db.scalar(
            select(modelo.id_propietario).where(modelo.paypal_order_id == order_id).limit(1)
        )
        if dueno is not None:
            return dueno
    return None


def capturar_pago(db: Session, usuario: Usuario, order_id: str) -> dict[str, Any]:
    """
    Tras la aprobación del comprador: captura la orden y aplica la compra.
    Nada de la orden se toma a ciegas — qué se compra sale del
    `reference_id` y se vuelve a planear con el estado actual, y además se
    exige que:
      - la orden sea de este propietario (`custom_id`),
      - el importe y la moneda coincidan con el precio vigente (una orden
        creada del lado del cliente con el client-id público podría declarar
        cualquier importe),
      - la orden no se haya usado antes (UNIQUE en `paypal_order_id`).
    """
    if not paypal_service.order_id_valido(order_id):
        raise DatoInvalido("Identificador de orden de PayPal inválido.")
    dueno = _orden_usada_por(db, order_id)
    if dueno is not None:
        if dueno == usuario.id:
            return obtener_estado(db, usuario)  # reintento del mismo pago: idempotente
        raise PlanConflicto("Esta orden de pago ya fue utilizada.")

    orden = paypal_service.obtener_orden(order_id)
    unidad = paypal_service.unidad_de_compra(orden) or {}

    coincidencia = _REFERENCIA_RE.match(unidad.get("reference_id") or "")
    if coincidencia is None:
        raise PlanConflicto("La orden no corresponde a una compra de plan.")
    if unidad.get("custom_id") != f"u{usuario.id}":
        raise PlanConflicto("La orden de pago no pertenece a tu cuenta.")
    id_plan, con_plan, con_reserva = coincidencia.groups()

    compra = planear_compra(db, usuario, int(id_plan), con_plan == "1", con_reserva == "1")
    valor, moneda = _importe(unidad)
    if moneda != settings.PAYPAL_CURRENCY or valor != compra.importe:
        raise PlanConflicto("El importe de la orden no corresponde al precio vigente.")

    estado = orden.get("status")
    if estado == "APPROVED":
        captura = paypal_service.capturar_orden(order_id)
        if captura.get("status") != "COMPLETED":
            raise paypal_service.ErrorPayPal(
                f"El pago no se completó (estado {captura.get('status')})."
            )
    elif estado != "COMPLETED":
        raise paypal_service.ErrorPayPal(f"El pago no fue aprobado (estado {estado}).")

    return _aplicar_compra(db, usuario, compra, paypal_order_id=order_id)


# --------------------------------------------------------------------------
# Avisos de renovación
# --------------------------------------------------------------------------
def _anio_vigente_sin_renovar(db: Session, usuario: Usuario) -> PropietarioSuscripcion:
    vigente = cuota.suscripcion_activa(db, usuario)
    if _cobertura(vigente) != Cobertura.pago:
        raise PlanConflicto("No tienes un plan de pago vigente.")
    return vigente


def cancelar(db: Session, usuario: Usuario) -> dict[str, Any]:
    """No quiere renovar: deja de recibir los avisos de renovación. El plan
    sigue vigente hasta `fecha_fin` (y, si tiene año de reserva, este sigue
    guardado). Idempotente."""
    vigente = _anio_vigente_sin_renovar(db, usuario)
    if vigente.cancelada_en is None:
        # DATETIME guarda segundos: así la respuesta coincide con lo que se relee
        vigente.cancelada_en = ahora().replace(microsecond=0)
        db.flush()
    return obtener_estado(db, usuario)


def reactivar(db: Session, usuario: Usuario) -> dict[str, Any]:
    """Vuelve a recibir los avisos de renovación. Idempotente."""
    vigente = _anio_vigente_sin_renovar(db, usuario)
    vigente.cancelada_en = None
    db.flush()
    return obtener_estado(db, usuario)


# --------------------------------------------------------------------------
# Soporte (panel admin)
# --------------------------------------------------------------------------
def asignar_plan(db: Session, usuario: Usuario, id_plan: int) -> dict[str, Any]:
    """Cambio manual de soporte, sin cobro: desde hoy el propietario queda en
    `id_plan` (un año con su cola si es de pago; sin caducidad si es el
    Gratuito). Valida que su uso actual quepa."""
    plan = db.get(Suscripcion, id_plan)
    if plan is None:
        raise PlanNoEncontrado("El plan solicitado no existe.")
    if cuota.plan_vigente(db, usuario).id == plan.id:
        raise PlanConflicto("El propietario ya tiene este plan.")
    excesos = cuota.excesos(cuota.uso_actual(db, usuario), plan)
    if excesos:
        raise PlanConflicto(
            "No puedes cambiar a este plan: el uso actual lo excede — " + "; ".join(excesos) + "."
        )
    if plan.costo_anual > 0:
        _abrir_anio(db, usuario, plan, hoy())
    else:
        _liberar_desde(db, usuario, hoy())
        db.add(
            PropietarioSuscripcion(
                id_propietario=usuario.id, id_suscripcion=plan.id, fecha_inicio=hoy()
            )
        )
        db.flush()
    return obtener_estado(db, usuario)


# --------------------------------------------------------------------------
# Barrido periódico: año de reserva y avisos
# --------------------------------------------------------------------------
def _procesar_reserva(db: Session, reserva: ReservaContinuidad) -> str | None:
    """Marca la reserva como activa al empezar su periodo y como consumida
    al terminar. Devuelve qué cambió ('activada', 'consumida') o None."""
    periodo = _periodo_de_reserva(db, reserva, solo_iniciado=True)
    if periodo is None:
        return None
    usuario = db.get(Usuario, reserva.id_propietario)
    assert usuario is not None
    cambio = None
    if reserva.estado == EstadoReserva.disponible:
        reserva.estado = EstadoReserva.activa
        reserva.activada_en = periodo.fecha_inicio
        cambio = "activada"
        if periodo.vigente_en(hoy()) and usuario.status_dms not in avisos_plan.SIN_AVISOS:
            assert periodo.fecha_fin is not None
            avisos_plan.avisar_una_vez(
                db,
                usuario,
                f"reserva:{reserva.id}:activa",
                "plan_reserva_activa",
                hasta=avisos_plan.fecha(periodo.fecha_fin),
            )
    if not periodo.vigente_en(hoy()):
        reserva.estado = EstadoReserva.consumida
        reserva.consumida_en = periodo.fecha_fin
        cambio = "consumida"
    return cambio


def _avisar_vigente(db: Session, usuario: Usuario) -> bool:
    """Aviso de renovación (30, 7 y 1 día antes) o de inicio de la gracia."""
    vigente = cuota.suscripcion_activa(db, usuario)
    cobertura = _cobertura(vigente)
    if cobertura == Cobertura.gracia:
        assert vigente.fecha_fin is not None
        return avisos_plan.avisar_una_vez(
            db,
            usuario,
            f"gracia:{vigente.id}",
            "plan_gracia",
            vencio=avisos_plan.fecha(vigente.fecha_inicio),
            hasta=avisos_plan.fecha(vigente.fecha_fin),
        )
    if cobertura != Cobertura.pago or vigente.cancelada_en is not None:
        return False
    ultimo = _ultimo_pagado(db, usuario)
    if ultimo is not None and ultimo.id != vigente.id:
        return False  # ya renovó
    assert vigente.fecha_fin is not None
    dias = (vigente.fecha_fin - hoy()).days
    umbral = avisos_plan.umbral_alcanzado(dias, _UMBRALES_RENOVACION)
    if umbral is None:
        return False
    reserva = _reserva_pendiente(db, usuario)
    return avisos_plan.avisar_una_vez(
        db,
        usuario,
        f"renovacion:{vigente.id}:{umbral}",
        "plan_renovacion",
        dias=dias,
        vence=avisos_plan.fecha(vigente.fecha_fin),
        con_reserva=reserva is not None and reserva.estado == EstadoReserva.disponible,
        importe=f"{vigente.suscripcion.costo_anual:,.2f}",
    )


def procesar_suscripciones(db: Session) -> dict[str, int]:
    """Paso del barrido: estado de los años de reserva y avisos de
    renovación y de gracia. Idempotente (los avisos van por `aviso_enviado`)."""
    cambios = {"reservas_activadas": 0, "reservas_consumidas": 0, "avisos": 0}
    pendientes = db.scalars(
        select(ReservaContinuidad).where(ReservaContinuidad.estado != EstadoReserva.consumida)
    ).all()
    for reserva in pendientes:
        if cambio := _procesar_reserva(db, reserva):
            cambios[f"reservas_{cambio}s"] += 1

    hoy_ = hoy()
    con_pago = db.scalars(
        select(Usuario)
        .join(Propietario, Propietario.id == Usuario.id)
        .join(PropietarioSuscripcion, PropietarioSuscripcion.id_propietario == Usuario.id)
        .join(Suscripcion, Suscripcion.id == PropietarioSuscripcion.id_suscripcion)
        .where(
            Suscripcion.costo_anual > 0,
            PropietarioSuscripcion.fecha_inicio <= hoy_,
            PropietarioSuscripcion.fecha_fin > hoy_,
            Propietario.status_dms.not_in(avisos_plan.SIN_AVISOS),
        )
        .distinct()
    ).all()
    for usuario in con_pago:
        cambios["avisos"] += _avisar_vigente(db, usuario)
    db.commit()
    return cambios
