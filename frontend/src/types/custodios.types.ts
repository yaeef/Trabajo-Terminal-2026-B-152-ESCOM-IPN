// 1:1 con backend/app/schemas/custodio.py (rutas /api/v1/custodios)

export interface CustodioResponse {
    id: number;
    nombre: string;
    paterno: string | null;
    materno: string | null;
    nombre_completo: string;
    parentesco: string;
    correo: string;
    correo_verificado: boolean;
    telegram_verificado: boolean;
    created_at: string | null;
}

// Telegram no va en el alta: la vinculación se dispara aparte
// (custodiosService.requestTelegramLink) y la completa el propio custodio
// interactuando con el bot.
export interface CustodioCreatePayload {
    nombre: string;
    paterno?: string | null;
    materno?: string | null;
    parentesco: string;
    correo: string;
}

export interface CustodioUpdatePayload {
    nombre?: string;
    paterno?: string | null;
    materno?: string | null;
    parentesco?: string;
    correo?: string;
}

// El deep link solo viaja al correo del custodio; al propietario no se le devuelve.
export interface EnlaceTelegramEnviadoResponse {
    detail: string;
    expira_en_segundos: number;
}

/** Un custodio solo puede vincularse a una bóveda si tiene al menos un
 *  canal de comunicación verificado (para poder notificarlo en la recuperación). */
/** Custodios con canal confirmado que se necesitan para crear una bóveda
 *  (RN-006: con menos no hay umbral de mayoría válido). Igual que MIN_N del backend. */
export const MIN_CUSTODIOS_BOVEDA = 3;

export const custodioNotificable = (c: {
    correo_verificado: boolean;
    telegram_verificado: boolean;
}): boolean => c.correo_verificado || c.telegram_verificado;

export const PARENTESCO_OPCIONES = [
    'Cónyuge',
    'Hijo/a',
    'Padre/Madre',
    'Hermano/a',
    'Familiar',
    'Amigo/a',
    'Abogado/Notario',
    'Otro',
];
