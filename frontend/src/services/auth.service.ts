import api from './api';
import type {
    LoginResponse,
    RegisterPayload,
    User,
    ForgotPasswordPayload,
    ResetPasswordPayload,
} from '../types/auth.types';

export const authService = {
    async login(username: string, password: string): Promise<LoginResponse> {
        // FastAPI OAuth2PasswordRequestForm requiere x-www-form-urlencoded.
        // El campo "username" acepta tanto username como correo (el backend
        // intenta ambos lookups).
        const params = new URLSearchParams();
        params.append('username', username);
        params.append('password', password);

        const { data } = await api.post<LoginResponse>('/api/v1/auth/login', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        localStorage.setItem('access_token', data.access_token);
        return data;
    },

    async register(payload: RegisterPayload): Promise<User> {
        const { data } = await api.post<User>('/api/v1/auth/register', payload);
        return data;
    },

    async confirmRegistration(token: string): Promise<{ detail: string }> {
        const { data } = await api.post<{ detail: string }>('/api/v1/auth/confirmar-registro', { token });
        return data;
    },

    async getMe(): Promise<User> {
        const { data } = await api.get<User>('/api/v1/users/me');
        return data;
    },

    async forgotPassword(payload: ForgotPasswordPayload): Promise<{ detail: string }> {
        const { data } = await api.post<{ detail: string }>('/api/v1/auth/forgot-password', payload);
        return data;
    },

    async resetPassword(payload: ResetPasswordPayload): Promise<{ detail: string }> {
        const { data } = await api.post<{ detail: string }>('/api/v1/auth/reset-password', payload);
        return data;
    },

    logout() {
        localStorage.removeItem('access_token');
    },

    getToken(): string | null {
        return localStorage.getItem('access_token');
    },
};
