import api from './api';
import type {
    BovedaResponse,
    BovedaCreatePayload,
    BovedaUpdatePayload,
    VssUploadPayload,
    VssResponse,
    CustodiosBatchPayload,
    CustodioBovedaResponse,
    CustodioResponse,
} from '../types/bovedas.types';

// backend/app/api/routes/bovedas.py  ->  /api/v1/bovedas
// backend/app/api/routes/custodios.py ->  /api/v1/custodios
export const bovedasService = {
    list: async (): Promise<BovedaResponse[]> =>
        (await api.get<BovedaResponse[]>('/api/v1/bovedas')).data,

    get: async (id: number): Promise<BovedaResponse> =>
        (await api.get<BovedaResponse>(`/api/v1/bovedas/${id}`)).data,

    create: async (payload: BovedaCreatePayload): Promise<BovedaResponse> =>
        (await api.post<BovedaResponse>('/api/v1/bovedas', payload)).data,

    update: async (id: number, payload: BovedaUpdatePayload): Promise<BovedaResponse> =>
        (await api.patch<BovedaResponse>(`/api/v1/bovedas/${id}`, payload)).data,

    remove: async (id: number, password: string): Promise<{ detail: string }> =>
        (await api.delete<{ detail: string }>(`/api/v1/bovedas/${id}`, { data: { password } })).data,

    verifyPassphrase: async (id: number, passphrase_verifier: string): Promise<BovedaResponse> =>
        (await api.post<BovedaResponse>(`/api/v1/bovedas/${id}/passphrase/verify`, { passphrase_verifier })).data,

    uploadVss: async (id: number, payload: VssUploadPayload): Promise<BovedaResponse> =>
        (await api.put<BovedaResponse>(`/api/v1/bovedas/${id}/vss`, payload)).data,

    getVss: async (id: number): Promise<VssResponse> =>
        (await api.get<VssResponse>(`/api/v1/bovedas/${id}/vss`)).data,

    listCustodiosVinculados: async (id: number): Promise<CustodioBovedaResponse[]> =>
        (await api.get<CustodioBovedaResponse[]>(`/api/v1/bovedas/${id}/custodios`)).data,

    setCustodios: async (id: number, payload: CustodiosBatchPayload): Promise<CustodioBovedaResponse[]> =>
        (await api.put<CustodioBovedaResponse[]>(`/api/v1/bovedas/${id}/custodios`, payload)).data,

    // Directorio completo de custodios del propietario (para el paso de vinculación).
    listDirectorio: async (): Promise<CustodioResponse[]> =>
        (await api.get<CustodioResponse[]>('/api/v1/custodios')).data,
};
