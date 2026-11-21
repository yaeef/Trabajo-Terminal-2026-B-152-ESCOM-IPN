// src/i18n.ts — idioma de la interfaz (español / inglés).
//
// Por defecto se usa el idioma del dispositivo (navigator.languages): si el
// primer idioma soportado que prefiere el usuario es español, la app sale en
// español; si es inglés, o el dispositivo no prefiere ninguno de los dos, en
// inglés. En cuanto el usuario elige uno con el botón ES/EN, esa elección se
// guarda en localStorage y manda sobre el dispositivo.
//
// Los textos viven junto al código que los usa: t('Texto', 'Text'). Así cada
// pantalla conserva su español original al lado de su traducción y TypeScript
// obliga a dar ambas. t() funciona también fuera de React (utils, hojas
// imprimibles); App se suscribe con useLang() y, al cambiar de idioma, se
// vuelve a renderizar todo el árbol sin desmontarlo (no se pierde el estado,
// p. ej. la llave en memoria de una sesión de recuperación).

import { useSyncExternalStore } from 'react';

export type Lang = 'es' | 'en';
const KEY = 'b152-lang';

function idiomaDelDispositivo(): Lang {
    const preferidos = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of preferidos) {
        const base = l?.slice(0, 2).toLowerCase();
        if (base === 'es' || base === 'en') return base;
    }
    return 'en';
}

function idiomaInicial(): Lang {
    try {
        const s = localStorage.getItem(KEY);
        if (s === 'es' || s === 'en') return s;
    } catch {
        /* localStorage bloqueado */
    }
    return idiomaDelDispositivo();
}

let actual: Lang = idiomaInicial();
document.documentElement.lang = actual;

const oyentes = new Set<() => void>();

export const getLang = (): Lang => actual;

/** Locale para fechas y números (toLocaleString). */
export const locale = (): string => (actual === 'es' ? 'es-MX' : 'en-US');

/** Elige el texto del idioma activo. */
export const t = (es: string, en: string): string => (actual === 'es' ? es : en);

export function setLang(l: Lang): void {
    if (l === actual) return;
    actual = l;
    document.documentElement.lang = l;
    try {
        localStorage.setItem(KEY, l);
    } catch {
        /* noop */
    }
    oyentes.forEach((f) => f());
}

function suscribir(f: () => void) {
    oyentes.add(f);
    return () => {
        oyentes.delete(f);
    };
}

/** Idioma activo; el componente se vuelve a renderizar cuando cambia. */
export function useLang(): Lang {
    return useSyncExternalStore(suscribir, getLang);
}
