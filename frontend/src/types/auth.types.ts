export interface SuscripcionActiva {
    nombre: string;
    fecha_inicio: string;
    fecha_fin: string | null;
}

export interface User {
    id: number;
    username: string;
    nombre: string;
    materno?: string | null;
    paterno?: string | null;
    correo: string;
    correo_sec?: string | null;
    id_telegram?: string | null;
    rol: string;
    suscripcion_activa?: SuscripcionActiva | null;
    /** Cola de eliminación de cuenta: null si no hay solicitud pendiente. */
    eliminacion_solicitada_en?: string | null;
    eliminacion_purga_en?: string | null;
    /** Estado del Interruptor de Hombre Muerto; null si no es propietario. */
    status_dms?: string | null;
}

export interface LoginResponse {
    access_token: string;
    token_type: string;
}

export interface RegisterPayload {
    username: string;
    nombre: string;
    paterno?: string;
    materno?: string;
    correo: string;
    correo_sec?: string;
    password: string;
    id_telegram?: string;
}

export interface ForgotPasswordPayload {
    correo: string;
}

export interface ResetPasswordPayload {
    token: string;
    nueva_password: string;
}
