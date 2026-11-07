import type { ProtocoloVidaResponse } from '../types/dms.types';
import { parseBackendDate } from './dates';

const DEFAULT_PERIODICIDAD_DIAS = 60; // mismo fallback que dms_service.registrar_prueba_de_vida en backend

export interface ProximaVerificacion {
    fecha: Date | null;
    diasRestantes: number | null;
    /** 'ok' si aún hay margen, 'warn' si está dentro del periodo de gracia o ya venció */
    estado: 'ok' | 'warn';
}

/**
 * Calcula la próxima fecha de check-in a partir de ultima_prueba +
 * periodicidad_prueba (con el mismo fallback de 60 días que usa el backend
 * cuando el propietario aún no configuró su umbral).
 */
export function calcularProximaVerificacion(data: ProtocoloVidaResponse): ProximaVerificacion {
    if (!data.ultima_prueba) {
        return { fecha: null, diasRestantes: null, estado: 'warn' };
    }

    const periodicidad = data.periodicidad_prueba ?? DEFAULT_PERIODICIDAD_DIAS;
    const ultima = parseBackendDate(data.ultima_prueba);
    const proxima = new Date(ultima);
    proxima.setDate(proxima.getDate() + periodicidad);

    const msPorDia = 1000 * 60 * 60 * 24;
    const diasRestantes = Math.ceil((proxima.getTime() - Date.now()) / msPorDia);

    const gracia = data.periodicidad_periodo_gracia ?? 0;
    const estado: 'ok' | 'warn' = diasRestantes <= gracia ? 'warn' : 'ok';

    return { fecha: proxima, diasRestantes, estado };
}

export function formatFechaCorta(fecha: Date): string {
    return fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
