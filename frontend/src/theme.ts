// src/theme.ts — modo claro/oscuro. Se aplica en <html> con data-theme
// (nuestras variables) y data-bs-theme (componentes Bootstrap 5.3).

export type Theme = 'light' | 'dark';
const KEY = 'b152-theme';

export function getTheme(): Theme {
    try {
        const s = localStorage.getItem(KEY);
        if (s === 'light' || s === 'dark') return s;
    } catch {
        /* localStorage bloqueado */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(t: Theme): void {
    const el = document.documentElement;
    el.setAttribute('data-theme', t);
    el.setAttribute('data-bs-theme', t);
    try {
        localStorage.setItem(KEY, t);
    } catch {
        /* noop */
    }
}

export function toggleTheme(): Theme {
    const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    return next;
}
