# backend/app/services/panel_service.py
"""
Resumen agregado para la vista principal (Dashboard). Reúne en una sola
respuesta lo que de otro modo pediría tres llamadas: /bovedas, /custodios y
/propietario/protocolo-vida.
"""

from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.custodio import Custodio
from app.models.usuario import Usuario
from app.services import boveda_service, cuota


def _insignia(b: dict[str, Any]) -> str:
    """Badge de la bóveda en el panel (mismo criterio que el frontend en /bovedas)."""
    if b["estado"] == "borrador" or b["total_fragmentos_n"] is None:
        return "borrador"
    if b["custodios_vinculados"] >= b["total_fragmentos_n"]:
        return "protegida"
    return "incompleta"


def construir_resumen(db: Session, usuario: Usuario) -> dict[str, Any]:
    """Forma de PanelResponse."""
    # Forma de BovedaResponse: ya traen usado/cuota y custodios_vinculados.
    bovedas = boveda_service.listar_bovedas(db, usuario)

    if bovedas:
        usado, limite = bovedas[0]["usado_bytes"], bovedas[0]["cuota_bytes"]
    else:  # sin bóvedas (p. ej. una cuenta recién creada) se consulta aparte
        usado, limite = cuota.uso_y_cuota(db, usuario)

    por_estado: dict[str, int] = {}
    protegidas = 0
    lista = []
    for b in bovedas:
        por_estado[b["estado"]] = por_estado.get(b["estado"], 0) + 1
        insignia = _insignia(b)
        if insignia == "protegida":
            protegidas += 1
        lista.append(
            {
                "id": b["id"],
                "pid": b["pid"],
                "nombre": b["nombre"],
                "categoria": b["categoria"],
                "umbral_k": b["umbral_k"],
                "total_fragmentos_n": b["total_fragmentos_n"],
                "estado": b["estado"],
                "custodios_vinculados": b["custodios_vinculados"],
                "badge": insignia,
                "created_at": b["created_at"],
            }
        )

    custodios_total = (
        db.query(func.count(Custodio.id)).filter(Custodio.id_propietario == usuario.id).scalar()
        or 0
    )

    p = usuario.propietario
    return {
        "bovedas_total": len(bovedas),
        "bovedas_por_estado": por_estado,
        "bovedas_protegidas": protegidas,
        "custodios_total": int(custodios_total),
        "usado_bytes": usado,
        "cuota_bytes": limite,
        "protocolo_vida": {
            "periodicidad_prueba": p.periodicidad_prueba if p else None,
            "periodicidad_periodo_gracia": p.periodicidad_periodo_gracia if p else None,
            "ultima_prueba": p.ultima_prueba if p else None,
            "status_dms": p.status_dms if p else "desconocido",
        },
        "bovedas": lista,
    }
