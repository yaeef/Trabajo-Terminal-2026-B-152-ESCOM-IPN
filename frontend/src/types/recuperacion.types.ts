// Corresponde a backend/app/schemas/recuperacion.py — portal público (sin sesión de usuario).

export interface BovedaRecuperacionResponse {
    pid: string;
    nombre: string;
    categoria: string | null;
    mensaje_custodios: string | null;
    umbral_k: number | null;
    total_fragmentos_n: number | null;
    recuperacion_iniciada_en: string | null;
    ventana_expira_en: string | null;
    commitments_hex: string | null;
    x_coords: number[] | null;
}

export interface FragmentoDepositadoResponse {
    x_fragmento: number;
    epk_hex: string;
    iv_hex: string;
    ciphertext_hex: string;
    nombre_declarado: string;
    vinculo_declarado: string;
    depositado_en: string;
    /** Custodio al que el propietario asignó esta x (null si no estaba asignada). */
    custodio_asignado: string | null;
}

export interface SesionEstadoResponse {
    existe: boolean;
    estado: 'activa' | 'expirada' | 'abandonada' | null;
    creada_en: string | null;
    expira_en: string | null;
    x_fundador: number | null;
    reconstruido_en: string | null;
    bp_public_key: string | null;
    bp_kdf_algo: string | null;
    bp_kdf_salt: string | null;
    bp_kdf_params: Record<string, unknown> | null;
    umbral_k: number | null;
    total_fragmentos_n: number | null;
    depositos: FragmentoDepositadoResponse[];
}

export interface DepositoPayload {
    x_fragmento: number;
    epk_hex: string;
    iv_hex: string;
    ciphertext_hex: string;
    nombre_declarado: string;
    vinculo_declarado: string;
}

/** Unirse a una sesión: la llave del BP que el custodio revisó y aceptó. */
export interface DepositarFragmentoPayload extends DepositoPayload {
    bp_public_key: string;
}

export interface CrearSesionPayload extends DepositoPayload {
    bp_public_key: string;
    bp_kdf_salt: string;
    bp_kdf_params: Record<string, unknown>;
}
