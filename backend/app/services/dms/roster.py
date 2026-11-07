"""Roster de custodios del DMS, quórum y condición de "armado"."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.boveda import Boveda, CustodioBoveda, EstadoBoveda
from app.models.custodio import Custodio
from app.models.usuario import Propietario, Usuario


def ids_roster(db: Session, id_propietario: int) -> list[int]:
    """Custodios distintos vinculados a alguna bóveda del propietario."""
    ids = db.scalars(
        select(CustodioBoveda.id_custodio)
        .join(Boveda, Boveda.id == CustodioBoveda.id_boveda)
        .where(Boveda.id_propietario == id_propietario)
        .distinct()
    )
    return sorted(set(ids))


def bovedas_recuperables(db: Session, id_propietario: int) -> list[Boveda]:
    """Bóvedas 'activa' (con VSS cargado): las que pasan a recuperación al liberar."""
    return list(
        db.scalars(
            select(Boveda).where(
                Boveda.id_propietario == id_propietario, Boveda.estado == EstadoBoveda.activa
            )
        )
    )


def armado(db: Session, prop: Propietario, usuario: Usuario) -> bool:
    """≥1 bóveda 'activa' con VSS · Nc ≥ 1 · propietario con ≥1 canal."""
    return bool(
        (usuario.correo or usuario.id_telegram)
        and bovedas_recuperables(db, prop.id)
        and ids_roster(db, prop.id)
    )


def quorum(nc: int) -> int:
    """Mayoría simple: k = ⌊Nc/2⌋ + 1."""
    return nc // 2 + 1


def custodios_roster(db: Session, prop: Propietario) -> list[Custodio]:
    """El roster congelado del episodio (o el actual si aún no se congeló)."""
    ids = prop.dms_roster_ronda or ids_roster(db, prop.id)
    if not ids:
        return []
    return list(db.scalars(select(Custodio).where(Custodio.id.in_(ids))))
