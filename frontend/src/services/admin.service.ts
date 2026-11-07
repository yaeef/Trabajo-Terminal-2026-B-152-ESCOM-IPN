import api from './api';
import type { BovedaResponse } from '../types/bovedas.types';
import type { CustodioResponse } from '../types/custodios.types';
import type { Plan, PlanActual } from '../types/subscription.types';
import type {
    AccionAdminPayload,
    AuditoriaListaResponse,
    BarridoResultado,
    CambiarPlanAdminPayload,
    CanalNotificacion,
    DmsEstado,
    EstadoNotificacion,
    ExtenderPlazoPayload,
    NotificacionesListaResponse,
    PropietarioDetalle,
    PropietariosListaResponse,
    PurgarCuentaPayload,
} from '../types/admin.types';

// backend/app/api/routes/admin.py -> /api/v1/admin
export const adminService = {
    // --- Propietarios ---
    buscarPropietarios: async (
        q: string,
        pagina = 1,
        tamPagina = 20,
    ): Promise<PropietariosListaResponse> =>
        (
            await api.get<PropietariosListaResponse>('/api/v1/admin/propietarios', {
                params: { q: q || undefined, pagina, tam_pagina: tamPagina },
            })
        ).data,

    detallePropietario: async (id: number): Promise<PropietarioDetalle> =>
        (await api.get<PropietarioDetalle>(`/api/v1/admin/propietarios/${id}`)).data,

    bovedasDePropietario: async (id: number): Promise<BovedaResponse[]> =>
        (await api.get<BovedaResponse[]>(`/api/v1/admin/propietarios/${id}/bovedas`)).data,

    cancelarEliminacion: async (id: number, payload: AccionAdminPayload): Promise<{ detail: string }> =>
        (await api.post(`/api/v1/admin/propietarios/${id}/cuenta/cancelar-eliminacion`, payload)).data,

    purgarAhora: async (id: number, payload: PurgarCuentaPayload): Promise<{ detail: string }> =>
        (await api.post(`/api/v1/admin/propietarios/${id}/cuenta/purgar-ahora`, payload)).data,

    // --- DMS ---
    estadoDms: async (id: number): Promise<DmsEstado> =>
        (await api.get<DmsEstado>(`/api/v1/admin/propietarios/${id}/dms`)).data,

    reenviarAvisoDms: async (id: number, payload: AccionAdminPayload): Promise<{ detail: string }> =>
        (await api.post(`/api/v1/admin/propietarios/${id}/dms/reenviar-aviso`, payload)).data,

    extenderPlazoDms: async (id: number, payload: ExtenderPlazoPayload): Promise<{ detail: string }> =>
        (await api.post(`/api/v1/admin/propietarios/${id}/dms/extender-plazo`, payload)).data,

    forzarBarridoDms: async (id: number, payload: AccionAdminPayload): Promise<BarridoResultado> =>
        (await api.post<BarridoResultado>(`/api/v1/admin/propietarios/${id}/dms/forzar-barrido`, payload)).data,

    // --- Custodios ---
    custodiosDePropietario: async (id: number): Promise<CustodioResponse[]> =>
        (await api.get<CustodioResponse[]>(`/api/v1/admin/propietarios/${id}/custodios`)).data,

    reenviarVerificacionCustodio: async (
        id: number,
        idCustodio: number,
        payload: AccionAdminPayload,
    ): Promise<CustodioResponse> =>
        (
            await api.post<CustodioResponse>(
                `/api/v1/admin/propietarios/${id}/custodios/${idCustodio}/reenviar-verificacion`,
                payload,
            )
        ).data,

    // --- Suscripción ---
    estadoSuscripcion: async (id: number): Promise<PlanActual> =>
        (await api.get<PlanActual>(`/api/v1/admin/propietarios/${id}/suscripcion`)).data,

    listarPlanes: async (): Promise<Plan[]> => (await api.get<Plan[]>('/api/v1/admin/planes')).data,

    cambiarPlan: async (id: number, payload: CambiarPlanAdminPayload): Promise<PlanActual> =>
        (await api.post<PlanActual>(`/api/v1/admin/propietarios/${id}/suscripcion/cambiar-plan`, payload)).data,

    // --- Notificaciones ---
    listarNotificaciones: async (params: {
        estado?: EstadoNotificacion;
        canal?: CanalNotificacion;
    }): Promise<NotificacionesListaResponse> =>
        (await api.get<NotificacionesListaResponse>('/api/v1/admin/notificaciones', { params })).data,

    reintentarNotificaciones: async (payload: AccionAdminPayload): Promise<{ enviadas: number }> =>
        (await api.post<{ enviadas: number }>('/api/v1/admin/notificaciones/reintentar-pendientes', payload))
            .data,

    // --- Auditoría ---
    listarAuditoria: async (idPropietario?: number): Promise<AuditoriaListaResponse> =>
        (
            await api.get<AuditoriaListaResponse>('/api/v1/admin/auditoria', {
                params: { id_propietario: idPropietario },
            })
        ).data,
};
