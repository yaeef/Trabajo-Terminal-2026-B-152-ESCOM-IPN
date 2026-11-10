// src/crypto/sss.ts
//
// Envoltura del motor C->WASM (Shamir Secret Sharing + Feldman VSS sobre
// secp256k1). Los .js/.wasm viven en /public/wasm y NO los procesa Vite:
// se cargan con un <script type="module"> inyectado en runtime, para que
// el loader nativo del navegador resuelva sss.js -> sss.wasm y sss-api.js
// -> ./sss.js con sus rutas relativas intactas.
//
// split()  -> fragmenta la DEK. Devuelve shares {id,y} + commitments (k*33 B).
// El backend recibe SOLO commitments_hex + las x; los `y` jamás salen del
// navegador (se descargan como archivos .sss para repartir a los custodios).

import { toHex } from './vaultCrypto';
import { trackSecret } from './sensitiveMemory';

/* eslint-disable @typescript-eslint/no-explicit-any */

const WASM_BASE = `${import.meta.env.BASE_URL || '/'}wasm/`;

interface SSSBridge {
    sss: any; // instancia de la clase SSS de sss-api.js
    files: any; // módulo sss-files.js
}

let _bridge: Promise<SSSBridge> | null = null;

function loadBridge(): Promise<SSSBridge> {
    if (_bridge) return _bridge;
    _bridge = new Promise<SSSBridge>((resolve, reject) => {
        const w = window as any;
        const done = () => {
            Promise.resolve(w.__B152_SSS__)
                .then((b: SSSBridge) => resolve(b))
                .catch(reject);
        };
        if (w.__B152_SSS__) return done();

        const s = document.createElement('script');
        s.type = 'module';
        // El navegador resuelve estos import relativos por sí mismo.
        s.textContent = `
            import createSSSModule from '${WASM_BASE}sss.js';
            import { SSS } from '${WASM_BASE}sss-api.js';
            import * as files from '${WASM_BASE}sss-files.js';
            window.__B152_SSS__ = SSS.load(createSSSModule).then((sss) => ({ sss, files }));
            window.dispatchEvent(new Event('b152-sss-ready'));
        `;
        s.onerror = () => reject(new Error('No se pudo cargar el motor WASM (sss.js).'));
        window.addEventListener('b152-sss-ready', done, { once: true });
        document.head.appendChild(s);
    });
    return _bridge;
}

export interface Share {
    id: number; // coordenada x, 1..65535
    y: Uint8Array; // 32 B — SECRETO, no se envía
}

export interface SplitResult {
    shares: Share[];
    commitmentsHex: string; // k*33 B en hex  -> esto sí va al backend
    xCoords: number[];
}

function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}

/** Fragmenta la DEK (32 B) en n partes con umbral k, con compromisos Feldman. */
export async function splitKey(dek: Uint8Array, n: number, k: number): Promise<SplitResult> {
    if (dek.length !== 32) throw new Error('La DEK debe ser de 32 bytes.');
    const { sss } = await loadBridge();
    const { shares, commitments } = sss.split(dek, n, k, { feldman: true });
    return {
        // cada `y` es un fragmento secreto -> se registra para wipe() posterior
        shares: shares.map((s: any) => ({ id: s.id, y: trackSecret(s.y as Uint8Array) })),
        commitmentsHex: toHex(commitments as Uint8Array),
        xCoords: shares.map((s: any) => s.id),
    };
}

/** Reconstruye la DEK desde >= k shares (pruebas locales / futura recuperación). */
export async function recoverKey(shares: Share[]): Promise<Uint8Array> {
    const { sss } = await loadBridge();
    return sss.recover(shares.map((s) => ({ id: s.id, y: s.y })));
}

/** Verifica un share contra los compromisos (mismo check que el portal de recuperación). */
export async function verifyShare(share: Share, commitmentsHex: string): Promise<boolean> {
    const { sss } = await loadBridge();
    return sss.verify({ id: share.id, y: share.y }, hexToBytes(commitmentsHex));
}

/** Texto del archivo share_<x>.sss (formato idéntico al CLI). */
export async function encodeShareFile(id: number, y: Uint8Array): Promise<string> {
    const { files } = await loadBridge();
    return files.encodeShare(id, y);
}

/** Parsea el contenido de un archivo .sss subido (portal de recuperación). */
export async function decodeShareFile(text: string): Promise<Share> {
    const { files } = await loadBridge();
    return files.decodeShare(text) as Share;
}

/** Nombre de custodio -> fragmento del nombre de archivo (sin acentos ni caracteres inválidos). */
export function slugNombreArchivo(nombre: string): string {
    return (
        nombre
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 60) || 'custodio'
    );
}

/** Dispara la descarga de un archivo de texto en el navegador. */
export function downloadText(filename: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
