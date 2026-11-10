import api from './api';
import type { Compra, Plan, PlanActual } from '../types/subscription.types';

export interface PaypalConfig {
    configured: boolean;
    client_id: string | null;
    currency: string;
    mode: string;
}

// backend/app/api/routes/suscripciones.py -> /api/v1/suscripciones
export const subscriptionService = {
    listPlanes: async (): Promise<Plan[]> =>
        (await api.get<Plan[]>('/api/v1/suscripciones/planes')).data,

    getActual: async (): Promise<PlanActual> =>
        (await api.get<PlanActual>('/api/v1/suscripciones/actual')).data,

    // Compra sin pasarela: solo cuando PayPal no está configurado ("simular pago").
    comprarSimulado: async (compra: Compra): Promise<PlanActual> =>
        (await api.post<PlanActual>('/api/v1/suscripciones/comprar', compra)).data,

    // La renovación es manual: cancelar solo apaga los avisos de renovación.
    cancelar: async (): Promise<PlanActual> =>
        (await api.post<PlanActual>('/api/v1/suscripciones/cancelar', {})).data,

    reactivar: async (): Promise<PlanActual> =>
        (await api.post<PlanActual>('/api/v1/suscripciones/reactivar', {})).data,

    // Plan vencido: qué bóveda se conserva si llega el recorte (null = regla por defecto).
    conservarBoveda: async (idBoveda: number | null): Promise<PlanActual> =>
        (await api.put<PlanActual>('/api/v1/suscripciones/impago/boveda-conservar', { id_boveda: idBoveda })).data,

    // --- Flujo de pago PayPal ---
    getPaypalConfig: async (): Promise<PaypalConfig> =>
        (await api.get<PaypalConfig>('/api/v1/suscripciones/paypal/config')).data,

    checkout: async (compra: Compra): Promise<{ order_id: string; status: string }> =>
        (await api.post('/api/v1/suscripciones/checkout', compra)).data,

    capturar: async (orderId: string): Promise<PlanActual> =>
        (await api.post<PlanActual>(`/api/v1/suscripciones/checkout/${orderId}/capturar`, {})).data,
};
