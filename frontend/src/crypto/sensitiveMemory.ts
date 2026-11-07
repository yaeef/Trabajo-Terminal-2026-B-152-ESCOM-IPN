// src/crypto/sensitiveMemory.ts
//
// Registro de buffers con material criptográfico sensible que vive en RAM
// del navegador (DEK AES-256, fragmentos Shamir `y`). Permite:
//   - wipe(buf): poner un buffer a cero cuando ya no se necesita
//   - purgeAll(): borrar TODO lo pendiente (lo llama el logout antes de
//     recargar la app, para que la memoria no quede con restos)
//
// Nota honesta: en JS no se puede garantizar el borrado (el GC pudo copiar
// el buffer). Esto es best-effort; el borrado "duro" real es la recarga
// completa de la página que hace el logout (destruye heap JS + WASM).

const registry = new Set<Uint8Array>();

/** Marca un buffer como sensible. Devuelve el mismo buffer (encadenable). */
export function trackSecret(buf: Uint8Array): Uint8Array {
    registry.add(buf);
    return buf;
}

/** Pone a cero un buffer y lo saca del registro. */
export function wipe(buf: Uint8Array | null | undefined): void {
    if (!buf) return;
    try {
        buf.fill(0);
    } catch {
        /* buffer detached */
    }
    registry.delete(buf);
}

/** Pone a cero todos los buffers registrados. Devuelve cuántos borró. */
export function purgeAll(): number {
    let n = 0;
    for (const b of registry) {
        try {
            b.fill(0);
            n += 1;
        } catch {
            /* detached */
        }
    }
    registry.clear();
    return n;
}

/** Cuántos buffers sensibles siguen vivos (para diagnóstico/UI). */
export function pendingSecrets(): number {
    return registry.size;
}
