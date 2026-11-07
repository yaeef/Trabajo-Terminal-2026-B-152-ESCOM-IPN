// Tipos 1:1 con backend/app/schemas/boveda.py

export interface KdfEnvelopeDTO {
    algo: string;
    salt: string;
    params: Record<string, unknown>;
}

export type EstadoBoveda =
    | 'borrador'
    | 'activa'
    | 'en_recuperacion'
    | 'expirada';

export interface BovedaResponse {
    id: number;
    pid: string;
    nombre: string;
    categoria: string | null;
    mensaje_custodios: string | null;
    kdf: KdfEnvelopeDTO;
    umbral_k: number | null;
    total_fragmentos_n: number | null;
    estado: EstadoBoveda;
    custodios_vinculados: number;
    /** Uso/cuota de almacenamiento de la CUENTA (mismo valor en cada bóveda). */
    usado_bytes: number;
    cuota_bytes: number;
    created_at: string | null;
}

export interface BovedaCreatePayload {
    nombre: string;
    categoria?: string | null;
    mensaje_custodios?: string | null;
    kdf: KdfEnvelopeDTO;
    passphrase_verifier: string;
}

export interface BovedaUpdatePayload {
    passphrase_verifier: string;
    nombre?: string;
    categoria?: string | null;
    mensaje_custodios?: string | null;
}

export interface VssUploadPayload {
    passphrase_verifier: string;
    n: number;
    k: number;
    commitments_hex: string;
    x_coords: number[];
}

export interface VssResponse {
    n: number;
    k: number;
    commitments_hex: string;
    x_coords: number[];
}

export interface AsignacionInput {
    id_custodio: number;
    x_fragmento: number;
}

export interface CustodiosBatchPayload {
    passphrase_verifier: string;
    asignaciones: AsignacionInput[];
}

export interface CustodioBovedaResponse {
    id_custodio: number;
    nombre: string;
    correo: string;
    x_fragmento: number;
    created_at: string | null;
}

// Directorio de custodios (backend/app/schemas/custodio.py)
export interface CustodioResponse {
    id: number;
    nombre: string;
    correo: string;
    correo_verificado: boolean;
    telegram_verificado: boolean;
    created_at: string | null;
}

/** Estado derivado para el badge de la tarjeta (bovedas.html). */
export type BovedaBadge = 'protegida' | 'incompleta' | 'borrador';

export function bovedaBadge(b: BovedaResponse): BovedaBadge {
    if (b.estado === 'borrador' || b.total_fragmentos_n == null) return 'borrador';
    // Protegida solo con TODOS los n custodios vinculados (tolerancia n-k a fallos).
    if (b.custodios_vinculados >= b.total_fragmentos_n) return 'protegida';
    return 'incompleta';
}
