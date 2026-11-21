import { t } from '../i18n';

// 1:1 con backend/app/schemas/admin.py (rutas /api/v1/admin)

export interface PropietarioListaItem {
    id: number;
    username: string;
    nombre: string;
    correo: string;
    created_at: string | null;
    status_dms: string | null;
    plan_nombre: string;
    eliminacion_solicitada_en: string | null;
}

export interface PropietariosListaResponse {
    total: number;
    pagina: number;
    tam_pagina: number;
    resultados: PropietarioListaItem[];
}

export interface PropietarioDetalle {
    id: number;
    username: string;
    nombre: string;
    correo: string;
    created_at: string | null;
    status_dms: string | null;
    eliminacion_solicitada_en: string | null;
    eliminacion_purga_en: string | null;
    plan_nombre: string;
    bovedas_total: number;
    custodios_total: number;
    usado_bytes: number;
    cuota_bytes: number;
}

export interface DmsVotoConteo {
    vida: number;
    fallecimiento: number;
}

export type SentidoVoto = 'vida' | 'fallecimiento';

export interface LiberacionVotoItem {
    custodio_nombre: string;
    sentido: SentidoVoto | null;
    votado_en: string | null;
}

export interface LiberacionRondaResumen {
    ronda: number;
    votos: LiberacionVotoItem[];
}

export type MotivoLiberacion = 'fallecimiento_confirmado' | 'limite_reconfirmaciones' | 'tiempo_agotado';

export interface LiberacionResumen {
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

export interface DmsEstado {
    status_dms: string;
    dms_ronda: number;
    dms_quorum: number | null;
    dms_reconfirmaciones: number;
    dms_alerta_en: string | null;
    dms_gracia_en: string | null;
    dms_reduccion_hasta: string | null;
    dms_ultimo_aviso: string | null;
    votos: DmsVotoConteo;
    resumen_liberacion: LiberacionResumen;
}

export interface BarridoResultado {
    transicion: string | null;
}

export type CanalNotificacion = 'correo' | 'telegram';
export type EstadoNotificacion = 'pendiente' | 'enviada' | 'fallida';

export interface NotificacionItem {
    id: number;
    canal: CanalNotificacion;
    destino: string;
    plantilla: string;
    estado: EstadoNotificacion;
    intentos: number;
    siguiente_intento_en: string;
    ultimo_error: string | null;
    creada_en: string;
    enviada_en: string | null;
}

export interface NotificacionesListaResponse {
    total: number;
    resultados: NotificacionItem[];
}

export interface AuditoriaItem {
    id: number;
    id_admin: number;
    id_propietario_afectado: number | null;
    accion: string;
    motivo: string;
    creado_en: string;
}

export interface AuditoriaListaResponse {
    total: number;
    resultados: AuditoriaItem[];
}

// --------------------------------------------------------------------------
// Payloads de acciones (todas exigen `motivo`: queda en la auditoría)
// --------------------------------------------------------------------------
export interface AccionAdminPayload {
    motivo: string;
}

export interface ExtenderPlazoPayload extends AccionAdminPayload {
    dias: number;
}

export interface CambiarPlanAdminPayload extends AccionAdminPayload {
    id_plan: number;
}

export interface PurgarCuentaPayload extends AccionAdminPayload {
    contrasena_admin: string;
}

const ACCION_LABELS: Record<string, [string, string]> = {
    cancelar_eliminacion: ['Canceló una eliminación', 'Cancelled a deletion'],
    purgar_cuenta: ['Purgó una cuenta', 'Purged an account'],
    extender_plazo_dms: ['Extendió un plazo del DMS', 'Extended a DMS deadline'],
    reenviar_aviso_dms: ['Reenvió un aviso del DMS', 'Resent a DMS notice'],
    forzar_barrido_dms: ['Forzó el barrido del DMS', 'Forced the DMS sweep'],
    reenviar_verificacion_custodio: ['Reenvió la verificación de un custodio', 'Resent a custodian verification'],
    cambiar_plan: ['Cambió un plan', 'Changed a plan'],
    reintentar_notificaciones: ['Reintentó notificaciones pendientes', 'Retried pending notifications'],
};

export const accionLabel = (accion: string): string => {
    const l = ACCION_LABELS[accion];
    return l ? t(...l) : accion;
};

export interface EstadoBadgeInfo {
    label: string;
    color: string;
    bg: string;
}

const ESTADO_BADGE_DEFAULT: EstadoBadgeInfo = { label: '—', color: '#475569', bg: '#e2e8f0' };

/** Badge del estado DMS de un propietario, con la etiqueta en el idioma activo. */
export function estadoDmsBadge(status: string | null | undefined): EstadoBadgeInfo {
    const badges: Record<string, EstadoBadgeInfo> = {
        activo: { label: t('Activo', 'Active'), color: '#15803d', bg: '#dcfce7' },
        alerta: { label: t('Alerta', 'Alert'), color: '#b45309', bg: '#fef3c7' },
        gracia: { label: t('Gracia', 'Grace'), color: '#b45309', bg: '#fef3c7' },
        gracia_reduccion: { label: t('Gracia (reducción)', 'Grace (downgrade)'), color: '#b91c1c', bg: '#fee2e2' },
        liberado: { label: t('Liberado', 'Released'), color: '#b91c1c', bg: '#fee2e2' },
        pausado_eliminacion: { label: t('En baja', 'Closing'), color: '#475569', bg: '#e2e8f0' },
        eliminado: { label: t('Eliminado', 'Deleted'), color: '#475569', bg: '#e2e8f0' },
    };
    return badges[status ?? ''] ?? ESTADO_BADGE_DEFAULT;
}
