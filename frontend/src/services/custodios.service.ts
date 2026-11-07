import api from './api';
import type {
    CustodioResponse,
    CustodioCreatePayload,
    CustodioUpdatePayload,
    EnlaceTelegramEnviadoResponse,
} from '../types/custodios.types';

// backend/app/api/routes/custodios.py  ->  /api/v1/custodios
export const custodiosService = {
    list: async (): Promise<CustodioResponse[]> =>
        (await api.get<CustodioResponse[]>('/api/v1/custodios')).data,

    create: async (payload: CustodioCreatePayload): Promise<CustodioResponse> =>
        (await api.post<CustodioResponse>('/api/v1/custodios', payload)).data,

    update: async (id: number, payload: CustodioUpdatePayload): Promise<CustodioResponse> =>
        (await api.patch<CustodioResponse>(`/api/v1/custodios/${id}`, payload)).data,

    remove: async (id: number): Promise<{ detail: string }> =>
        (await api.delete<{ detail: string }>(`/api/v1/custodios/${id}`)).data,

    resendVerification: async (id: number): Promise<{ detail: string }> =>
        (await api.post<{ detail: string }>(`/api/v1/custodios/${id}/reenviar-verificacion`)).data,

    // Envía al custodio (por correo) el deep link para vincular su Telegram;
    // es él quien lo completa hablando con el bot, nunca se pide un @usuario.
    requestTelegramLink: async (id: number): Promise<EnlaceTelegramEnviadoResponse> =>
        (await api.post<EnlaceTelegramEnviadoResponse>(`/api/v1/custodios/${id}/telegram/link-code`)).data,

    unlinkTelegram: async (id: number): Promise<{ detail: string }> =>
        (await api.delete<{ detail: string }>(`/api/v1/custodios/${id}/telegram`)).data,

    // Público, sin sesión: el custodio llega desde el link del correo.
    confirmChannel: async (token: string): Promise<{ detail: string }> =>
        (await api.post<{ detail: string }>('/api/v1/custodios/confirmar', { token })).data,
};
