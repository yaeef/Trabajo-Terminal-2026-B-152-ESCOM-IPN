// 1:1 con backend/app/schemas/activo.py

export interface IniciarSubidaPayload {
    passphrase_verifier: string;
    nombre: string;
    mime?: string | null;
    plantilla?: string | null;
    tamano_bytes: number;
    tamano_cifrado: number;
    iv_hex: string;
    sha256_plano?: string | null;
}

export interface IniciarSubidaResponse {
    activo_id: number;
    blob_name: string;
    sas_url: string;
    expira_en_segundos: number;
}

export interface DescargaResponse {
    sas_url: string;
    iv_hex: string;
    nombre_original: string;
    mime: string | null;
    expira_en_segundos: number;
}

export interface ActivoResponse {
    id: number;
    nombre_original: string;
    mime: string | null;
    plantilla: string | null;
    tamano_bytes: number;
    tamano_cifrado: number;
    estado: 'pendiente' | 'activo';
    created_at: string | null;
}
