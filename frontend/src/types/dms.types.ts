// Tipos para el módulo de Protocolo de Vida / DMS (CU-015, CU-011 checkins).
// Corresponden 1:1 a los schemas Pydantic en backend/app/schemas/user.py.

export interface ProtocoloVidaResponse {
    periodicidad_prueba: number | null;
    periodicidad_periodo_gracia: number | null;
    ultima_prueba: string | null; // ISO datetime
    status_dms: string;
}

export interface ProtocoloVidaUpdatePayload {
    periodicidad_prueba: number;
    periodicidad_periodo_gracia: number;
}

export interface CheckinLogItem {
    fecha_prueba: string;
    metodo: string;
    identificador: string | null;
    ip_origen: string | null;
    dias_extendidos: number;
}

export interface CheckinHistoryResponse {
    inactividad_permitida: number | null;
    ultima_senal: string | null;
    estado_interruptor: string;
    logs: CheckinLogItem[];
}

// --- Atestación pública de custodios (Interruptor de Hombre Muerto) ---
export type SentidoAtestacion = 'vida' | 'fallecimiento';

// Bóveda activa del propietario donde este custodio tiene un fragmento
// asignado, con sus compromisos Feldman públicos para validar localmente
// (mismo mecanismo que el portal de recuperación real, ver crypto/sss.ts).
export interface AtestacionBovedaCandidata {
    pid: string;
    nombre: string;
    commitments_hex: string;
    x_coords: number[];
}

export interface AtestacionContexto {
    propietario_nombre: string;
    estado: string;
    vigente: boolean;
    ya_voto: boolean;
    sentido: SentidoAtestacion | null;
    bovedas: AtestacionBovedaCandidata[];
}

export interface AtestacionResultado {
    registrado: boolean;
    sentido: SentidoAtestacion;
    transicion: string | null;
}

// --- Resumen post-liberación (aviso al hacer login si ya se liberó el patrimonio) ---
export type MotivoLiberacion = 'fallecimiento_confirmado' | 'limite_reconfirmaciones' | 'tiempo_agotado';

export interface LiberacionVotoItem {
    custodio_nombre: string;
    sentido: SentidoAtestacion | null; // null = no alcanzó a votar
    votado_en: string | null;
}

export interface LiberacionRondaResumen {
    ronda: number;
    votos: LiberacionVotoItem[];
}

export interface LiberacionResumenResponse {
    liberado: boolean;
    liberado_en: string | null;
    motivo: MotivoLiberacion | null;
    motivo_detalle: string;
    alerta_en: string | null;
    gracia_en: string | null;
    quorum: number | null;
    total_custodios: number;
    reconfirmaciones: number;
    max_reconfirmaciones: number;
    rondas: LiberacionRondaResumen[];
}
