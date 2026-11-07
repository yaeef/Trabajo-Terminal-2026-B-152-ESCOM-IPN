import api from './api';
import type {
    SecondaryEmailRequestPayload,
    ConfirmSecondaryEmailPayload,
    TelegramLinkCodeResponse,
} from '../types/channels.types';

// Corresponde a backend/app/api/routes/channels.py, montado bajo /api/v1/canales.
export const channelsService = {
    async requestSecondaryEmail(correoNuevo: string): Promise<{ detail: string }> {
        const payload: SecondaryEmailRequestPayload = { correo_nuevo: correoNuevo };
        const { data } = await api.post<{ detail: string }>('/api/v1/canales/correo-secundario', payload);
        return data;
    },

    async confirmSecondaryEmail(token: string): Promise<{ detail: string }> {
        const payload: ConfirmSecondaryEmailPayload = { token };
        const { data } = await api.post<{ detail: string }>('/api/v1/canales/correo-secundario/confirmar', payload);
        return data;
    },

    async unlinkSecondaryEmail(): Promise<{ detail: string }> {
        const { data } = await api.delete<{ detail: string }>('/api/v1/canales/correo-secundario');
        return data;
    },

    async createTelegramLinkCode(): Promise<TelegramLinkCodeResponse> {
        const { data } = await api.post<TelegramLinkCodeResponse>('/api/v1/canales/telegram/link-code');
        return data;
    },

    async unlinkTelegram(): Promise<{ detail: string }> {
        const { data } = await api.delete<{ detail: string }>('/api/v1/canales/telegram');
        return data;
    },
};
