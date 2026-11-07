import api from './api';
import type { DashboardResponse } from '../types/dashboard.types';

// backend/app/api/routes/dms.py -> /api/v1/propietario/dashboard
export const dashboardService = {
    get: async (): Promise<DashboardResponse> =>
        (await api.get<DashboardResponse>('/api/v1/propietario/dashboard')).data,
};
