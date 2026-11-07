// 1:1 con backend/app/schemas/dashboard.py

import type { EstadoBoveda, BovedaBadge } from './bovedas.types';

export interface DashboardBoveda {
    id: number;
    pid: string;
    nombre: string;
    categoria: string | null;
    umbral_k: number | null;
    total_fragmentos_n: number | null;
    estado: EstadoBoveda;
    custodios_vinculados: number;
    badge: BovedaBadge;
    created_at: string | null;
}

export interface DashboardProtocolo {
    periodicidad_prueba: number | null;
    periodicidad_periodo_gracia: number | null;
    ultima_prueba: string | null;
    status_dms: string;
}

export interface DashboardResponse {
    bovedas_total: number;
    bovedas_por_estado: Record<string, number>;
    bovedas_protegidas: number;
    custodios_total: number;
    usado_bytes: number;
    cuota_bytes: number;
    protocolo_vida: DashboardProtocolo;
    bovedas: DashboardBoveda[];
}
