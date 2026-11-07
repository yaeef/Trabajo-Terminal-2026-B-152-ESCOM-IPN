import api from './api';
import type {
    BovedaRecuperacionResponse,
    SesionEstadoResponse,
    CrearSesionPayload,
    DepositarFragmentoPayload,
    FragmentoDepositadoResponse,
} from '../types/recuperacion.types';
import type { ActivoResponse, DescargaResponse } from '../types/activos.types';

// Endpoint PÚBLICO (sin sesión): quien busca no tiene cuenta en el sistema.
// Corresponde a backend/app/api/routes/recuperacion.py, montado en
// /api/v1/recuperacion.
export const recuperacionService = {
    async buscarBoveda(pid: string): Promise<BovedaRecuperacionResponse> {
        const { data } = await api.get<BovedaRecuperacionResponse>(
            `/api/v1/recuperacion/bovedas/${encodeURIComponent(pid)}`,
        );
        return data;
    },

    async getSesion(pid: string): Promise<SesionEstadoResponse> {
        const { data } = await api.get<SesionEstadoResponse>(
            `/api/v1/recuperacion/bovedas/${encodeURIComponent(pid)}/sesion`,
        );
        return data;
    },

    async crearSesion(pid: string, payload: CrearSesionPayload): Promise<SesionEstadoResponse> {
        const { data } = await api.post<SesionEstadoResponse>(
            `/api/v1/recuperacion/bovedas/${encodeURIComponent(pid)}/sesion`,
            payload,
        );
        return data;
    },

    async marcarReconstruido(pid: string): Promise<SesionEstadoResponse> {
        const { data } = await api.post<SesionEstadoResponse>(
            `/api/v1/recuperacion/bovedas/${encodeURIComponent(pid)}/sesion/reconstruido`,
        );
        return data;
    },

    async depositarFragmento(
        pid: string,
        payload: DepositarFragmentoPayload,
    ): Promise<FragmentoDepositadoResponse> {
        const { data } = await api.post<FragmentoDepositadoResponse>(
            `/api/v1/recuperacion/bovedas/${encodeURIComponent(pid)}/sesion/fragmentos`,
            payload,
        );
        return data;
    },

    async listarActivos(pid: string): Promise<ActivoResponse[]> {
        const { data } = await api.get<ActivoResponse[]>(
            `/api/v1/recuperacion/bovedas/${encodeURIComponent(pid)}/activos`,
        );
        return data;
    },

    async prepararDescarga(pid: string, activoId: number): Promise<DescargaResponse> {
        const { data } = await api.post<DescargaResponse>(
            `/api/v1/recuperacion/bovedas/${encodeURIComponent(pid)}/activos/${activoId}/descarga`,
        );
        return data;
    },
};
