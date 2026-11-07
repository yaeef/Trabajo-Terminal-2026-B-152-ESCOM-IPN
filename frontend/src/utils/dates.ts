/**
 * El backend guarda y serializa fechas en UTC, pero sin indicador de zona
 * horaria (ej. "2026-08-29T14:22:05" en vez de "...Z" o "...+00:00").
 * Ver auth_service.py: "fecha_expiracion se guarda en UTC naive... si se
 * guardara aware, la comparación posterior fallaría con TypeError".
 *
 * Sin esta función, `new Date(iso)` interpretaría ese string como si YA
 * fuera hora local del navegador, desfasando cualquier fecha mostrada
 * según el huso horario del usuario (ej. 6 horas de diferencia en México).
 *
 * Esta función asume UTC solo cuando el string no trae ya su propia zona
 * horaria (para no romper timestamps que sí vinieran con offset).
 */
export function parseBackendDate(iso: string): Date {
    const yaTraeZonaHoraria = /Z$|[+-]\d{2}:?\d{2}$/.test(iso);
    return new Date(yaTraeZonaHoraria ? iso : `${iso}Z`);
}
