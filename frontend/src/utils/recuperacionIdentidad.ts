// src/utils/recuperacionIdentidad.ts
//
// El nombre/alias que alguien declara al depositar su fragmento no es
// secreto (ya viaja en claro al servidor), así que a diferencia de la DEK
// o la llave privada del BP, sí conviene que sobreviva un refresh dentro de
// la misma pestaña — si no, el dashboard no tiene forma de volver a saber
// "quién eres tú" entre esta bóveda y la siguiente. sessionStorage encaja
// exacto: dura mientras la pestaña esté abierta, se pierde al cerrarla.

const KEY_PREFIX = 'b152-recuperacion-nombre:';

export function recordarNombre(pid: string, nombre: string): void {
    try {
        sessionStorage.setItem(KEY_PREFIX + pid, nombre);
    } catch {
        /* sessionStorage bloqueado (modo privado, etc.) — no es crítico */
    }
}

export function nombreRecordado(pid: string): string | undefined {
    try {
        return sessionStorage.getItem(KEY_PREFIX + pid) ?? undefined;
    } catch {
        return undefined;
    }
}
