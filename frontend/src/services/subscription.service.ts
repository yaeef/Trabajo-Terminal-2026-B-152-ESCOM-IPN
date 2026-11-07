import api from './api';
import type { Plan, PlanActual } from '../types/subscription.types';

export interface PaypalConfig {
    configured: boolean;
    client_id: string | null;
    currency: string;
    mode: string;
}

// backend/app/api/routes/subscriptions.py -> /api/v1/suscripciones
export const subscriptionService = {
    listPlanes: async (): Promise<Plan[]> =>
        (await api.get<Plan[]>('/api/v1/suscripciones/planes')).data,

    getActual: async (): Promise<PlanActual> =>
        (await api.get<PlanActual>('/api/v1/suscripciones/actual')).data,

    // Cambio directo, sin pasarela: planes gratuitos, bajadas de plan o "simular pago".
    cambiar: async (planId: number): Promise<PlanActual> =>
        (await api.post<PlanActual>('/api/v1/suscripciones/cambiar', { plan_id: planId })).data,

    // El plan de pago sigue vigente hasta fecha_fin; después pasa a Gratuito.
    cancelar: async (): Promise<PlanActual> =>
        (await api.post<PlanActual>('/api/v1/suscripciones/cancelar', {})).data,

    // Deshace la cancelación mientras el plan siga vigente.
    reactivar: async (): Promise<PlanActual> =>
        (await api.post<PlanActual>('/api/v1/suscripciones/reactivar', {})).data,

    // --- Flujo de pago PayPal ---
    getPaypalConfig: async (): Promise<PaypalConfig> =>
        (await api.get<PaypalConfig>('/api/v1/suscripciones/paypal/config')).data,

    checkout: async (planId: number): Promise<{ order_id: string; status: string }> =>
        (await api.post('/api/v1/suscripciones/checkout', { plan_id: planId })).data,

    capturar: async (orderId: string): Promise<PlanActual> =>
        (await api.post<PlanActual>(`/api/v1/suscripciones/checkout/${orderId}/capturar`, {})).data,
};
