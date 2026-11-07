// src/crypto/recuperacionCrypto.ts
//
// Cifrado hacia la sesión de recuperación: ECIES con X25519 (acuerdo de
// llave) + AES-256-GCM (cifrado simétrico). El servidor solo relé
// ciphertext — nunca ve un fragmento (x,y) en claro.
//
// La llave PRIVADA del Beneficiario Principal (BP) nunca se persiste en
// ningún lado, ni siquiera cifrada: se re-deriva determinísticamente de su
// pass-phrase de sesión (PBKDF2-SHA256, mismo patrón que vaultCrypto.ts)
// cada vez que la necesita, en cualquier navegador.
//
// WebCrypto no expone "escalar -> punto base" para X25519 — no hay forma de
// obtener la llave pública a partir de una llave privada importada cruda
// (verificado empíricamente: exportKey('raw', privateKey) está bloqueado
// por especificación). Por eso ese único paso usa @noble/curves (auditada,
// JS puro, sin WASM); el acuerdo ECDH real y el cifrado AES-GCM siguen
// siendo 100% WebCrypto nativo.

import { x25519 } from '@noble/curves/ed25519';
import { toHex, fromHex } from './vaultCrypto';
import { trackSecret, wipe } from './sensitiveMemory';
import type { Share } from './sss';

export const BP_KDF_ALGO = 'pbkdf2-sha256' as const;
export const BP_KDF_ITERATIONS = 600_000;

export interface BpKdfEnvelope {
    algo: string;
    salt: string; // hex
    params: Record<string, unknown>;
}

export const randomSaltHex = (bytes = 16): string => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

export function bpKdfEnvelope(saltHex: string): BpKdfEnvelope {
    return { algo: BP_KDF_ALGO, salt: saltHex, params: { iterations: BP_KDF_ITERATIONS } };
}

/** Semilla determinística de 32 B desde la pass-phrase de sesión (PBKDF2-SHA256). */
async function deriveSeed(passphrase: string, saltHex: string, iterations: number): Promise<Uint8Array> {
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
    return trackSecret(new Uint8Array(bits));
}

export interface BpKeypair {
    privateKey: Uint8Array; // 32 B, escalar X25519 — SECRETO, wipe() al terminar
    publicKeyHex: string;   // 32 B en hex — NO secreta, se manda al servidor
}

/**
 * Re-deriva el par de llaves del BP desde su pass-phrase de sesión.
 * Determinístico: misma pass-phrase + mismo salt -> siempre el mismo par,
 * en cualquier navegador/dispositivo. `env` viene del servidor (salt/params
 * no son secretos, igual que el kdf de una bóveda).
 */
export async function deriveBpKeypair(passphrase: string, env: BpKdfEnvelope): Promise<BpKeypair> {
    const iterations = Number(env.params?.iterations ?? BP_KDF_ITERATIONS);
    const privateKey = await deriveSeed(passphrase, env.salt, iterations); // ya trackeado como secreto
    const publicKey = x25519.getPublicKey(privateKey);
    return { privateKey, publicKeyHex: toHex(publicKey) };
}

/** Par de llaves aleatorio y efímero — uno nuevo por cada fragmento cifrado. */
function randomEphemeralKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
    const privateKey = trackSecret(x25519.utils.randomPrivateKey());
    const publicKey = x25519.getPublicKey(privateKey);
    return { privateKey, publicKey };
}

/**
 * El secreto ECDH crudo no se usa directo como llave AES: se pasa por
 * SHA-256 antes (KDF de un solo paso) para no usar bytes de la curva tal
 * cual como material simétrico.
 */
async function aesKeyFromSharedSecret(shared: Uint8Array): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest('SHA-256', shared);
    return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface FragmentoCifrado {
    epkHex: string;
    ivHex: string;
    ciphertextHex: string;
}

/** Cifra un fragmento (share.y, 32 B) hacia la llave pública de sesión del BP. */
export async function cifrarFragmento(share: Share, bpPublicKeyHex: string): Promise<FragmentoCifrado> {
    const { privateKey: epk, publicKey: epkPub } = randomEphemeralKeypair();
    try {
        const shared = x25519.getSharedSecret(epk, fromHex(bpPublicKeyHex));
        const aesKey = await aesKeyFromSharedSecret(shared);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, share.y);
        return { epkHex: toHex(epkPub), ivHex: toHex(iv), ciphertextHex: toHex(new Uint8Array(ct)) };
    } finally {
        wipe(epk);
    }
}

export interface DepositoCifrado {
    xFragmento: number;
    epkHex: string;
    ivHex: string;
    ciphertextHex: string;
}

/**
 * Descifra un fragmento depositado con la llave privada del BP (no la borra:
 * se reutiliza para cada depósito de la sesión). Lanza si el ciphertext no
 * corresponde a esta sesión (llave equivocada / manipulado) — el llamador
 * decide si mostrarlo como "depósito inválido" en vez de tumbar todo.
 */
export async function descifrarFragmento(dep: DepositoCifrado, bpPrivateKey: Uint8Array): Promise<Share> {
    const shared = x25519.getSharedSecret(bpPrivateKey, fromHex(dep.epkHex));
    const aesKey = await aesKeyFromSharedSecret(shared);
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromHex(dep.ivHex) },
        aesKey,
        fromHex(dep.ciphertextHex),
    );
    return { id: dep.xFragmento, y: trackSecret(new Uint8Array(plain)) };
}
