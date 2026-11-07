import api from './api';
import type { User } from '../types/auth.types';
import type { UserUpdatePayload, ChangePasswordPayload } from '../types/user.types';

// Corresponde a backend/app/api/routes/users.py, montado bajo /api/v1/users.
export const userService = {
    async updateProfile(payload: UserUpdatePayload): Promise<User> {
        const { data } = await api.patch<User>('/api/v1/users/me', payload);
        return data;
    },

    async changePassword(payload: ChangePasswordPayload): Promise<{ detail: string }> {
        const { data } = await api.put<{ detail: string }>('/api/v1/users/me/password', payload);
        return data;
    },

    /**
     * Encola la cuenta para eliminación con periodo de gracia. No borra nada
     * todavía: la cuenta queda bloqueada y un job la purga al vencer el plazo.
     */
    async requestDeletion(password: string): Promise<{ detail: string; purga_en: string }> {
        const { data } = await api.delete<{ detail: string; purga_en: string }>('/api/v1/users/me', {
            data: { password },
        });
        return data;
    },

    /** Cancela una solicitud de eliminación pendiente y reactiva la cuenta. */
    async cancelDeletion(): Promise<{ detail: string }> {
        const { data } = await api.post<{ detail: string }>('/api/v1/users/me/eliminacion/cancelar');
        return data;
    },

    /** Purga inmediata (opción "Eliminar ahora" en la pantalla de cuenta en cola). */
    async deleteNow(password: string): Promise<{ detail: string }> {
        const { data } = await api.post<{ detail: string }>('/api/v1/users/me/eliminacion/ahora', {
            password,
        });
        return data;
    },
};
