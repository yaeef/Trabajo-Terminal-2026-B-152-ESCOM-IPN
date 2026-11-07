// src/crypto/assetCrypto.ts
//
// Cifrado/descifrado de activos en el navegador con AES-256-GCM y la DEK de
// la bóveda. El tag de autenticación va concatenado al final del ciphertext
// (así lo hace WebCrypto). El backend solo ve bytes opacos.

const toHex = (buf: ArrayBuffer | Uint8Array): string => {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const fromHex = (hex: string): Uint8Array => {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
};

async function importKey(dek: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', dek, 'AES-GCM', false, [usage]);
}

// Tope REAL por archivo: no es el del backend (activo.py permite hasta 5 GiB),
// sino un límite duro de la Web Crypto API. encryptFile() carga el archivo
// completo en un ArrayBuffer y lo pasa a crypto.subtle.encrypt(); verificado
// empíricamente (Node/V8, mismo motor que Chrome) que AES-GCM.encrypt()
// lanza "data must be less than 2147483648 bits" (= 2^31 bytes) para
// cualquier entrada >= 2 GiB. Ese es el cuello de botella real, no el backend.
export const MAX_FILE_BYTES = 2 ** 31 - 1; // 2 GiB - 1 byte

export interface EncryptedAsset {
    ciphertext: Blob;      // ct || tag
    ivHex: string;         // 12 B
    sha256Hex: string;     // hash del archivo en claro
    tamanoBytes: number;   // archivo en claro
    tamanoCifrado: number; // ciphertext (cuenta para la cuota)
}

/** Cifra un File completo. Para archivos muy grandes esto carga todo en RAM;
 *  el tope por archivo está limitado en el backend (5 GiB). */
export async function encryptFile(dek: Uint8Array, file: File): Promise<EncryptedAsset> {
    const plain = await file.arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await importKey(dek, 'encrypt');
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    const sha = await crypto.subtle.digest('SHA-256', plain);
    return {
        ciphertext: new Blob([ct], { type: 'application/octet-stream' }),
        ivHex: toHex(iv),
        sha256Hex: toHex(sha),
        tamanoBytes: file.size,
        tamanoCifrado: ct.byteLength,
    };
}

/** Descifra el ciphertext bajado del blob. Devuelve un Blob listo para descargar. */
export async function decryptToBlob(
    dek: Uint8Array,
    ivHex: string,
    ciphertext: ArrayBuffer,
    mime?: string | null,
): Promise<Blob> {
    const key = await importKey(dek, 'decrypt');
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromHex(ivHex) },
        key,
        ciphertext,
    );
    return new Blob([plain], { type: mime || 'application/octet-stream' });
}

/** Dispara la descarga de un Blob en el navegador. */
export function saveBlob(filename: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function humanBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < u.length - 1) {
        v /= 1024;
        i += 1;
    }
    return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
}
