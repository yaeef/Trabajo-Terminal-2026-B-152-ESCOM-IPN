// Tipos 1:1 con backend/app/schemas/boveda.py

import { t } from '../i18n';

// Categorías de bóveda: el valor guardado en el backend es el español;
// categoriaLabel solo traduce lo que se muestra.
const CATEGORIAS: Record<string, string> = {
    'Finanzas / Crypto': 'Finance / Crypto',
    'Documentos Legales': 'Legal Documents',
    'Personal': 'Personal',
    'Accesos / Contraseñas': 'Logins / Passwords',
    'Cuentas Digitales': 'Digital Accounts',
    'Seguros y Beneficiarios': 'Insurance & Beneficiaries',
    'Propiedades y Patrimonio': 'Property & Assets',
    'Salud': 'Health',
    'Negocios / Empresa': 'Business / Company',
    'Trabajo / Profesional': 'Work / Professional',
    'Instrucciones de Sucesión': 'Succession Instructions',
    'Otro': 'Other',
};

export const CATEGORIAS_BOVEDA = Object.keys(CATEGORIAS);

const ESTADOS_EN: Record<string, string> = {
    borrador: 'draft',
    activa: 'active',
    en_recuperacion: 'in recovery',
    expirada: 'expired',
};

/** Estado de la bóveda tal como se muestra (en español, el valor del backend). */
export const estadoBovedaLabel = (e: string): string => t(e, ESTADOS_EN[e] ?? e);

/** Texto a mostrar de una categoría guardada (valores desconocidos se muestran tal cual). */
export const categoriaLabel = (c: string): string => (CATEGORIAS[c] ? t(c, CATEGORIAS[c]) : c);

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
