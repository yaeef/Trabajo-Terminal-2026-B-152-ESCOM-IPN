// src/crypto/vaultCrypto.ts
//
// Capa criptográfica de la bóveda — TODO ocurre en el navegador.
// La pass-phrase y la DEK NUNCA salen de aquí. Al backend solo van:
//   - la envoltura KDF (algo, salt, params)  -> no secreta
//   - passphrase_verifier = sha256("b152-verify" || DEK)  -> solo para comparar
//
// KDF: PBKDF2-SHA256 vía WebCrypto (cero dependencias). El backend acepta
// `algo: "pbkdf2-sha256"` con `params` libre; usamos { iterations }.

import { WORDLIST, WORD_BITS } from './wordlist-es';
import { trackSecret, wipe } from './sensitiveMemory';

export const KDF_ALGO = 'pbkdf2-sha256' as const;
export const KDF_ITERATIONS = 600_000;
export const VERIFIER_PREFIX = 'b152-verify';

export interface KdfEnvelope {
    algo: string;
    salt: string; // hex
    params: Record<string, unknown>;
}

const toHex = (buf: ArrayBuffer | Uint8Array): string => {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const fromHex = (hex: string): Uint8Array => {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
};

export const randomSaltHex = (bytes = 16): string =>
    toHex(crypto.getRandomValues(new Uint8Array(bytes)));

/** Deriva la DEK AES-256 (32 bytes) desde la pass-phrase. Nunca se envía. */
export async function deriveDEK(
    passphrase: string,
    saltHex: string,
    iterations: number = KDF_ITERATIONS,
): Promise<Uint8Array> {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
        keyMaterial,
        256,
    );
    // Se registra como material sensible: quien lo use debe llamar wipe()
    // al terminar; el logout lo borra con purgeAll() si quedó pendiente.
    return trackSecret(new Uint8Array(bits));
}

/** verifier = sha256("b152-verify" || DEK) en hex. Es lo único que ve el backend. */
export async function computeVerifier(dek: Uint8Array): Promise<string> {
    const prefix = new TextEncoder().encode(VERIFIER_PREFIX);
    const msg = new Uint8Array(prefix.length + dek.length);
    msg.set(prefix, 0);
    msg.set(dek, prefix.length);
    return toHex(await crypto.subtle.digest('SHA-256', msg));
}

export function kdfEnvelope(saltHex: string): KdfEnvelope {
    return { algo: KDF_ALGO, salt: saltHex, params: { iterations: KDF_ITERATIONS } };
}

/** Deriva DEK + verifier en un paso. El llamador debe wipe(dek) al terminar. */
export async function deriveFromEnvelope(
    passphrase: string,
    env: KdfEnvelope,
): Promise<{ dek: Uint8Array; verifier: string }> {
    const iterations = Number(env.params?.iterations ?? KDF_ITERATIONS);
    const dek = await deriveDEK(passphrase, env.salt, iterations);
    const verifier = await computeVerifier(dek);
    return { dek, verifier };
}

/**
 * Solo el verificador: deriva la DEK, calcula el verifier y BORRA la DEK
 * de inmediato. Para pantallas que solo necesitan validar la pass-phrase
 * (Gestionar Bóveda, reanudar wizard de una bóveda ya activa).
 */
export async function deriveVerifier(passphrase: string, env: KdfEnvelope): Promise<string> {
    const { dek, verifier } = await deriveFromEnvelope(passphrase, env);
    wipe(dek);
    return verifier;
}

// --- Sugerir frase de alta entropía (diceware-es) ---
const WORD_SET = new Set(WORDLIST);

/** Índice uniforme en [0, max) sin sesgo de módulo (rechazo). */
function randIndex(max: number): number {
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    const buf = new Uint32Array(1);
    let x: number;
    do {
        crypto.getRandomValues(buf);
        x = buf[0];
    } while (x >= limit);
    return x % max;
}

export const SUGGESTED_WORDS = 8; // ~88 bits con BIP-39 español (2048 palabras, 11 bits/palabra)
export const SUGGESTED_BITS = Math.round(SUGGESTED_WORDS * WORD_BITS);

/** Devuelve una pass-phrase diceware de `nWords` palabras separadas por '-'. */
export function suggestPassphrase(nWords: number = SUGGESTED_WORDS): string {
    return Array.from({ length: nWords }, () => WORDLIST[randIndex(WORDLIST.length)]).join('-');
}

// Piso de entropía para una frase escrita a mano (la sugerida trae ~88 bits).
// Compartido por cualquier pantalla que le pida al usuario una pass-phrase
// nueva de la que dependa una llave criptográfica (bóveda, sesión de
// recuperación): mismo criterio de qué cuenta como "segura" en toda la app.
export const MIN_PASSPHRASE_BITS = 45;

/** Medidor de robustez por entropía para la UI (barra + color + etiqueta).
 *  La barra se llena por completo (verde) para una frase fuerte; la
 *  sugerida (~8 palabras) siempre la llena. */
export function passphraseMeter(bits: number) {
    return {
        pct: Math.min(Math.round((bits / 68) * 100), 100),
        color: bits < 40 ? '#ef4444' : bits < 62 ? '#f59e0b' : '#2ecc71',
        label: bits < 40 ? 'Débil' : bits < 62 ? 'Aceptable' : 'Fuerte',
    };
}

/**
 * Estimación de entropía de una pass-phrase (para el medidor):
 *  - si parece diceware (tokens en la lista) -> nTokens * bits/palabra
 *  - si no -> estimación por clases de caracteres (conservadora)
 */
export function passphraseBits(pw: string): number {
    const t = pw.trim();
    if (!t) return 0;
    const tokens = t.split(/[-\s_]+/).filter(Boolean);
    const inList = tokens.filter((w) => WORD_SET.has(w.toLowerCase())).length;
    if (tokens.length >= 3 && inList >= tokens.length - 1) {
        return Math.round(tokens.length * WORD_BITS);
    }
    let pool = 0;
    if (/[a-z]/.test(t)) pool += 26;
    if (/[A-Z]/.test(t)) pool += 26;
    if (/[0-9]/.test(t)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(t)) pool += 20;
    return Math.round(t.length * Math.log2(pool || 2));
}

export { toHex, fromHex };
