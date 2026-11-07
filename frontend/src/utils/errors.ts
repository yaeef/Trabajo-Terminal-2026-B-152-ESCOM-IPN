import type { AxiosError } from 'axios';

interface FastApiErrorBody {
    detail?: string | { msg: string }[];
}

/**
 * FastAPI puede devolver `detail` de tres formas distintas:
 * - string: errores de negocio ("Credenciales inválidas")
 * - array de objetos: errores 422 de validación de Pydantic
 * - undefined: error de red, servidor caído, timeout, etc.
 *
 * Sin esto, renderizar `error.response.data.detail` directo en JSX
 * rompe cuando el backend devuelve un 422.
 */
export function getApiErrorMessage(err: unknown, fallback = 'Ocurrió un error inesperado'): string {
    const error = err as AxiosError<FastApiErrorBody>;
    const detail = error?.response?.data?.detail;

    if (!detail) return fallback;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
        // Pydantic v2 antepone "Value error, " a los mensajes de validadores
        // personalizados (los que hacen `raise ValueError(...)`); sin esto se
        // filtra ese prefijo técnico al usuario.
        return detail.map((d) => d.msg.replace(/^Value error,\s*/i, '')).join(' | ');
    }
    return fallback;
}