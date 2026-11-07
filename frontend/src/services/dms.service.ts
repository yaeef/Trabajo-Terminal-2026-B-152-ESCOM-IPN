import api from './api';
import type {
    ProtocoloVidaResponse,
    ProtocoloVidaUpdatePayload,
    CheckinHistoryResponse,
    LiberacionResumenResponse,
} from '../types/dms.types';

// Corresponde a backend/app/api/routes/dms.py, montado en backend/app/main.py
// bajo el prefijo /api/v1/propietario (OJO: no es "/dms", así se registró ahí).
export const dmsService = {
    async getProtocoloVida(): Promise<ProtocoloVidaResponse> {
        const { data } = await api.get<ProtocoloVidaResponse>('/api/v1/propietario/protocolo-vida');
        return data;
    },

    async updateProtocoloVida(payload: ProtocoloVidaUpdatePayload): Promise<ProtocoloVidaResponse> {
        const { data } = await api.patch<ProtocoloVidaResponse>('/api/v1/propietario/protocolo-vida', payload);
        return data;
    },

    async getCheckinHistory(): Promise<CheckinHistoryResponse> {
        const { data } = await api.get<CheckinHistoryResponse>('/api/v1/propietario/checkins');
        return data;
    },

    async getLiberacionResumen(): Promise<LiberacionResumenResponse> {
        const { data } = await api.get<LiberacionResumenResponse>('/api/v1/propietario/liberacion-resumen');
        return data;
    },
};
