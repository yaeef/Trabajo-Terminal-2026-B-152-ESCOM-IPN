// src/utils/progress.ts
//
// Con archivos/operaciones ligeras, cifrar o llamar a la API puede resolver
// en milisegundos y el usuario nunca alcanza a leer el texto de la fase
// ("Cifrando…", "Subiendo…", etc.) antes de saltar a la siguiente.
// withMinDelay fuerza que cada fase se muestre al menos MIN_STEP_MS, aunque
// la operación real haya terminado antes. Se comparte entre todos los
// modales de progreso (subir archivos, guardar plantillas) para que el
// tiempo de espera sea homogéneo en toda la app.

export const MIN_STEP_MS = 2000;

export async function withMinDelay<T>(promise: Promise<T>, min: number = MIN_STEP_MS): Promise<T> {
    const start = performance.now();
    const result = await promise;
    const elapsed = performance.now() - start;
    if (elapsed < min) await new Promise((r) => setTimeout(r, min - elapsed));
    return result;
}
