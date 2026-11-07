// Corresponden a los enums reales del backend:
// - MetodoPruebaVida (backend/app/models/prueba_vida_log.py)
// - status_dms en Propietario (valores usados por dms_service: "activo",
//   "en_alerta", "confirmando_inactividad", "disparado", "eliminado")

import { parseBackendDate } from './dates';

export interface MetodoInfo {
    label: string;
    icon: string;
    colorClass: string;
}

const METODO_INFO: Record<string, MetodoInfo> = {
    web_interface: { label: 'Web Interface', icon: 'fa-globe', colorClass: 'text-primary' },
    telegram_bot: { label: 'Telegram Bot', icon: 'fa-telegram', colorClass: 'text-info' },
    email_auth: { label: 'Email Auth', icon: 'fa-envelope', colorClass: 'text-warning' },
};

export function getMetodoInfo(metodo: string): MetodoInfo {
    return METODO_INFO[metodo] ?? { label: metodo, icon: 'fa-question', colorClass: 'text-muted' };
}

/** El ícono de Telegram vive en fab (brands), no en fas como el resto. */
export function getMetodoIconPrefix(metodo: string): 'fas' | 'fab' {
    return metodo === 'telegram_bot' ? 'fab' : 'fas';
}

interface StatusInfo {
    label: string;
    colorVar: string;
}

const STATUS_INFO: Record<string, StatusInfo> = {
    activo: { label: 'Activo', colorVar: 'var(--success-green)' },
    en_alerta: { label: 'En Alerta', colorVar: '#f59e0b' },
    confirmando_inactividad: { label: 'Confirmando Inactividad', colorVar: '#f97316' },
    disparado: { label: 'Disparado', colorVar: '#dc2626' },
    eliminado: { label: 'Eliminado', colorVar: '#94a3b8' },
};

export function getStatusInfo(status: string): StatusInfo {
    return STATUS_INFO[status] ?? { label: status, colorVar: '#64748b' };
}

/** Divide un ISO datetime en { hora, fecha } para la columna "Marca de Tiempo". */
export function splitFechaHora(iso: string): { hora: string; fecha: string } {
    const d = parseBackendDate(iso);
    const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const fecha = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    return { hora, fecha };
}

/** "Hace X minutos/horas/días", usado en la tarjeta "Última Señal". */
export function formatRelativo(iso: string): string {
    const ms = Date.now() - parseBackendDate(iso).getTime();
    const minutos = Math.floor(ms / 60000);

    if (minutos < 1) return 'Hace un momento';
    if (minutos < 60) return `Hace ${minutos} min`;

    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `Hace ${horas} hora${horas === 1 ? '' : 's'}`;

    const dias = Math.floor(horas / 24);
    return `Hace ${dias} día${dias === 1 ? '' : 's'}`;
}
