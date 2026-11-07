import api from './api';
import type {
    AtestacionContexto,
    AtestacionResultado,
    SentidoAtestacion,
} from '../types/dms.types';

// Endpoint PÚBLICO (sin sesión): el custodio llega desde el enlace del correo
// del Interruptor de Hombre Muerto. Corresponde a
// backend/app/api/routes/atestacion.py, montado en /api/v1/atestacion.
export const atestacionService = {
    async getContexto(token: string): Promise<AtestacionContexto> {
        const { data } = await api.get<AtestacionContexto>(
            `/api/v1/atestacion/${encodeURIComponent(token)}`,
        );
        return data;
    },

    async votar(
        token: string,
        sentido: SentidoAtestacion,
        pidBoveda: string,
        xFragmento: number,
    ): Promise<AtestacionResultado> {
        const { data } = await api.post<AtestacionResultado>(
            `/api/v1/atestacion/${encodeURIComponent(token)}`,
            { sentido, pid_boveda: pidBoveda, x_fragmento: xFragmento },
        );
        return data;
    },
};
