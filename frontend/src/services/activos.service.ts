import api from './api';
import type {
    IniciarSubidaPayload,
    IniciarSubidaResponse,
    DescargaResponse,
    ActivoResponse,
} from '../types/activos.types';

// backend/app/api/routes/activos.py -> /api/v1/bovedas/{id}/activos
export const activosService = {
    list: async (bovedaId: number): Promise<ActivoResponse[]> =>
        (await api.get<ActivoResponse[]>(`/api/v1/bovedas/${bovedaId}/activos`)).data,

    iniciar: async (bovedaId: number, payload: IniciarSubidaPayload): Promise<IniciarSubidaResponse> =>
        (await api.post<IniciarSubidaResponse>(`/api/v1/bovedas/${bovedaId}/activos/iniciar`, payload)).data,

    confirmar: async (bovedaId: number, activoId: number, passphrase_verifier: string): Promise<ActivoResponse> =>
        (await api.post<ActivoResponse>(
            `/api/v1/bovedas/${bovedaId}/activos/${activoId}/confirmar`,
            { passphrase_verifier },
        )).data,

    descarga: async (bovedaId: number, activoId: number, passphrase_verifier: string): Promise<DescargaResponse> =>
        (await api.post<DescargaResponse>(
            `/api/v1/bovedas/${bovedaId}/activos/${activoId}/descarga`,
            { passphrase_verifier },
        )).data,

    remove: async (bovedaId: number, activoId: number, passphrase_verifier: string): Promise<{ detail: string }> =>
        (await api.delete<{ detail: string }>(`/api/v1/bovedas/${bovedaId}/activos/${activoId}`, {
            data: { passphrase_verifier },
        })).data,

    // --- interacción DIRECTA con el blob (no pasa por el backend) ---
    putBlob: async (sasUrl: string, ciphertext: Blob): Promise<void> => {
        const r = await fetch(sasUrl, {
            method: 'PUT',
            headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/octet-stream' },
            body: ciphertext,
        });
        if (!r.ok) throw new Error(`Fallo al subir el archivo cifrado (HTTP ${r.status}).`);
    },

    getBlob: async (sasUrl: string): Promise<ArrayBuffer> => {
        const r = await fetch(sasUrl);
        if (!r.ok) throw new Error(`Fallo al descargar el archivo (HTTP ${r.status}).`);
        return r.arrayBuffer();
    },
};
