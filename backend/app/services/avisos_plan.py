"""
Avisos al propietario sobre su plan: renovación, gracia, año de reserva e
impago. Cada aviso lleva una `clave` y se registra en `aviso_enviado`, así el
barrido horario lo envía una sola vez aunque la condición siga cumpliéndose.

Solo encolan (ver services/notificaciones): salen si la transacción se confirma.
"""

from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.tiempo import ahora
from app.models.impago import AvisoEnviado
from app.models.usuario import EstadoDMS, Usuario
from app.services import notificaciones

# Al propietario que falleció (DMS liberado) o cuya cuenta se purgó no se le
# escribe sobre pagos: sus herederos no tienen por qué recibirlo.
SIN_AVISOS = frozenset({EstadoDMS.liberado, EstadoDMS.eliminado})


def fecha(dia: date) -> str:
    return dia.strftime("%d/%m/%Y")


def umbral_alcanzado(dias: int, umbrales: tuple[int, ...]) -> int | None:
    """El umbral más cercano ya alcanzado (p. ej. con (30, 7, 1) y 5 días
    restantes, 7). None si aún faltan más días que el mayor. Así, si el
    barrido estuvo detenido, se manda el aviso que corresponde hoy y no
    todos los atrasados de golpe."""
    alcanzados = [u for u in umbrales if dias <= u]
    return min(alcanzados) if alcanzados else None


def ya_enviado(db: Session, usuario: Usuario, clave: str) -> bool:
    return (
        db.scalar(
            select(AvisoEnviado.id).where(
                AvisoEnviado.id_propietario == usuario.id, AvisoEnviado.clave == clave
            )
        )
        is not None
    )


def marcar(db: Session, usuario: Usuario, clave: str) -> None:
    db.add(AvisoEnviado(id_propietario=usuario.id, clave=clave, enviado_en=ahora()))


def avisar(db: Session, usuario: Usuario, plantilla: str, **datos: Any) -> None:
    """Al correo principal, al secundario (si lo tiene) y a su Telegram."""
    datos["nombre"] = (usuario.nombre or "").strip() or usuario.username
    for correo in (usuario.correo, usuario.correo_sec):
        notificaciones.encolar_correo(db, correo, plantilla, **datos)
    notificaciones.encolar_telegram(db, usuario.id_telegram, plantilla, **datos)


def avisar_una_vez(db: Session, usuario: Usuario, clave: str, plantilla: str, **datos: Any) -> bool:
    """Envía el aviso si esta `clave` no se ha enviado antes. True si lo envió."""
    if ya_enviado(db, usuario, clave):
        return False
    marcar(db, usuario, clave)
    avisar(db, usuario, plantilla, **datos)
    return True
