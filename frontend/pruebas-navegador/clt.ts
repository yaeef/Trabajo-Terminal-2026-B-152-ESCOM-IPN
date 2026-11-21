// frontend/pruebas-navegador/clt.ts
//
// Pruebas del cliente (CLT-01 a CLT-10) y medición de rendimiento en el
// navegador. Usa el código real de src/crypto y el motor WebAssembly de
// public/wasm, sin dobles de prueba. La página envía los resultados en JSON a
// POST /resultados (ver servidor.py); correr.sh orquesta los navegadores.
//
//   ?suite=clt    solo los casos de prueba
//   ?suite=bench  solo las mediciones
//   (sin suite)   ambos

import {
    deriveDEK,
    computeVerifier,
    kdfEnvelope,
    deriveVerifier,
    randomSaltHex,
    suggestPassphrase,
    passphraseBits,
    MIN_PASSPHRASE_BITS,
    SUGGESTED_WORDS,
    KDF_ITERATIONS,
    toHex,
    fromHex,
} from '../src/crypto/vaultCrypto';
import { encryptFile, decryptToBlob } from '../src/crypto/assetCrypto';
import {
    deriveBpKeypair,
    bpKdfEnvelope,
    cifrarFragmento,
    descifrarFragmento,
} from '../src/crypto/recuperacionCrypto';
import { splitKey, recoverKey, verifyShare, encodeShareFile, decodeShareFile, type Share } from '../src/crypto/sss';
import { wipe, purgeAll, pendingSecrets, trackSecret } from '../src/crypto/sensitiveMemory';
import { WORDLIST } from '../src/crypto/wordlist-es';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Datos de prueba ──────────────────────────────────────────────────

// Participaciones y compromisos generados con la herramienta de línea de
// comandos (bin/sss split -n 5 -k 3 -f) a partir del secreto de la Tabla de
// datos de la biblioteca. Sirven para comprobar que el navegador lee y
// verifica los archivos que produce la herramienta nativa (RNF-007).
const SECRETO_CLI = 'deadbeef0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c';
const COMPROMISOS_CLI = `.:FELDMAN-COMMIT:.
V:2
K:3
0:02759bd75e919514e4e834e5dd770ac821b559a766a07142bbd6435539cdff39dc
1:03c5d1d04d6231f1ab17f38a2ff3f5a4fc173890d0f7a5d7a293f915ed6275f651
2:029595ee5e929b11cc73c678f344d8368056e636ac078566d9dbcbfdaebb6d33f4
.:END-FELDMAN-COMMIT:.
`;
const PARTICIPACIONES_CLI = [
    '22412:7cbbc1ba923824a09d0e10041e69e7665dda00ae6d05adf556822a713966338d',
    '29959:194282c266f3b79557175dfdc0992f52f6d36bb5c87ebc7dec8def934c55a5fd',
    '51154:6d04644c20407c7be1b4c888d4f19e2366d1dec43435e5b1f8173aec71573ece',
    '51452:a263a4bbdabaad104c5e864178b2855b30950eb04ba77a05d3ff29aa0da24f65',
    '8218:9b5cfe5edc0a23f1d7fd8127580f447748686d62d1b8fad0fef8ebad6b089689',
].map((l) => `.:SSS-KEY:.\n${l}\n.:END-SSS-KEY:.\n`);

// Vectores de PBKDF2-HMAC-SHA-256 (RFC 7914, sección 11), primeros 32 bytes.
const VECTORES_PBKDF2 = [
    { p: 'passwd', s: 'salt', c: 1, dk: '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc' },
    { p: 'Password', s: 'NaCl', c: 80000, dk: '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56' },
];

// ── Utilidades ───────────────────────────────────────────────────────

const enc = new TextEncoder();
const hexDe = (t: string) => toHex(enc.encode(t));
const MiB = 1024 * 1024;

function afirmar(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function lanza(fn: () => Promise<unknown>): Promise<boolean> {
    try {
        await fn();
        return false;
    } catch {
        return true;
    }
}

const iguales = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Archivo de `n` bytes con un patrón no trivial (el costo de AES no depende del contenido). */
function archivo(n: number, nombre = 'activo.bin'): File {
    const u8 = new Uint8Array(n);
    for (let i = 0; i < n; i += 4096) u8[i] = (i * 2654435761) >>> 24;
    return new File([u8], nombre, { type: 'application/octet-stream' });
}

async function motorArchivos(): Promise<any> {
    return (await (window as any).__B152_SSS__).files;
}

// ── Casos de prueba ──────────────────────────────────────────────────

interface Caso {
    id: string;
    titulo: string;
    req: string;
    fn: () => Promise<string>;
}

const casos: Caso[] = [
    {
        id: 'CLT-01',
        titulo: 'Derivación de la llave con PBKDF2-SHA-256',
        req: 'RF-007',
        fn: async () => {
            const env = kdfEnvelope(randomSaltHex());
            afirmar(env.algo === 'pbkdf2-sha256', 'algoritmo distinto de pbkdf2-sha256');
            afirmar(env.params.iterations === 600_000 && KDF_ITERATIONS === 600_000, 'iteraciones distintas de 600 000');
            afirmar(/^[0-9a-f]{32}$/.test(env.salt), 'la sal no es de 16 bytes');
            afirmar(randomSaltHex() !== randomSaltHex(), 'dos sales aleatorias iguales');
            for (const v of VECTORES_PBKDF2) {
                const dk = await deriveDEK(v.p, hexDe(v.s), v.c);
                afirmar(toHex(dk) === v.dk, `vector ${v.p}/${v.s}/${v.c} no coincide`);
                wipe(dk);
            }
            const sal = randomSaltHex();
            const a = await deriveDEK('frase de prueba', sal, 1000);
            const b = await deriveDEK('frase de prueba', sal, 1000);
            const c = await deriveDEK('frase de prueba', randomSaltHex(), 1000);
            afirmar(a.length === 32 && iguales(a, b), 'la derivación no es determinista o no da 32 bytes');
            afirmar(!iguales(a, c), 'sales distintas dieron la misma llave');
            [a, b, c].forEach(wipe);
            return '2 vectores RFC 7914 correctos; 600 000 iteraciones; sal de 16 bytes';
        },
    },
    {
        id: 'CLT-02',
        titulo: 'Frase de la llave maestra: sugerencia y entropía mínima',
        req: 'RN-001',
        fn: async () => {
            const s = suggestPassphrase();
            const palabras = s.split('-');
            afirmar(palabras.length === SUGGESTED_WORDS && SUGGESTED_WORDS === 8, 'la sugerencia no tiene 8 palabras');
            afirmar(palabras.every((w) => WORDLIST.includes(w)), 'palabra fuera de la lista');
            afirmar(WORDLIST.length === 2048, 'la lista no tiene 2048 palabras');
            const bits = passphraseBits(s);
            afirmar(bits === 88 && bits >= MIN_PASSPHRASE_BITS, `entropía sugerida de ${bits} bits`);
            afirmar(suggestPassphrase() !== s, 'dos sugerencias iguales');
            afirmar(passphraseBits('hola1234') < MIN_PASSPHRASE_BITS, 'una frase débil supera el mínimo');
            return `sugerencia de 8 palabras (${bits} bits); mínimo ${MIN_PASSPHRASE_BITS} bits`;
        },
    },
    {
        id: 'CLT-03',
        titulo: 'Verificador de la llave maestra',
        req: 'RF-007',
        fn: async () => {
            const env = { algo: 'pbkdf2-sha256', salt: randomSaltHex(), params: { iterations: 1000 } };
            const dek = await deriveDEK('correcta', env.salt, 1000);
            const v = await computeVerifier(dek);
            const msg = new Uint8Array([...enc.encode('b152-verify'), ...dek]);
            const esperado = toHex(await crypto.subtle.digest('SHA-256', msg));
            afirmar(v === esperado && /^[0-9a-f]{64}$/.test(v), 'el verificador no es SHA-256("b152-verify" || DEK)');
            wipe(dek);
            const antes = pendingSecrets();
            const v1 = await deriveVerifier('correcta', env);
            const v2 = await deriveVerifier('correcta', env);
            const v3 = await deriveVerifier('incorrecta', env);
            afirmar(v1 === v && v2 === v, 'la misma frase dio verificadores distintos');
            afirmar(v3 !== v, 'frases distintas dieron el mismo verificador');
            afirmar(pendingSecrets() === antes, 'deriveVerifier dejó la llave en memoria');
            return 'verificador determinista; frase incorrecta detectada; la llave se borra al terminar';
        },
    },
    {
        id: 'CLT-04',
        titulo: 'Cifrado y descifrado de un activo con AES-256-GCM',
        req: 'RF-006, RNF-001',
        fn: async () => {
            const dek = trackSecret(crypto.getRandomValues(new Uint8Array(32)));
            const f = archivo(MiB, 'nota.pdf');
            const plano = new Uint8Array(await f.arrayBuffer());
            const a = await encryptFile(dek, f);
            const b = await encryptFile(dek, f);
            afirmar(/^[0-9a-f]{24}$/.test(a.ivHex), 'el IV no es de 12 bytes');
            afirmar(a.ivHex !== b.ivHex, 'dos cifrados usaron el mismo IV');
            afirmar(a.tamanoCifrado === f.size + 16, 'el cifrado no agrega la etiqueta de 16 bytes');
            const sha = toHex(await crypto.subtle.digest('SHA-256', plano));
            afirmar(a.sha256Hex === sha, 'el hash del archivo en claro no coincide');
            const ctA = await a.ciphertext.arrayBuffer();
            const ctB = new Uint8Array(await b.ciphertext.arrayBuffer());
            afirmar(!iguales(new Uint8Array(ctA), ctB), 'dos cifrados del mismo archivo son iguales');
            afirmar(!iguales(new Uint8Array(ctA).subarray(0, 64), plano.subarray(0, 64)), 'el cifrado contiene el texto en claro');
            const de = new Uint8Array(await (await decryptToBlob(dek, a.ivHex, ctA)).arrayBuffer());
            afirmar(iguales(de, plano), 'el descifrado no reproduce el archivo');
            wipe(dek);
            return 'archivo de 1 MiB: descifrado idéntico; IV distinto en cada cifrado; etiqueta de 16 bytes';
        },
    },
    {
        id: 'CLT-05',
        titulo: 'Integridad: se rechazan datos alterados, llaves e IV incorrectos',
        req: 'RNF-001',
        fn: async () => {
            const dek = trackSecret(crypto.getRandomValues(new Uint8Array(32)));
            const otra = trackSecret(crypto.getRandomValues(new Uint8Array(32)));
            const a = await encryptFile(dek, archivo(4096));
            const ct = new Uint8Array(await a.ciphertext.arrayBuffer());
            const alterado = ct.slice();
            alterado[100] ^= 0x01;
            const ivMalo = (a.ivHex[0] === '0' ? '1' : '0') + a.ivHex.slice(1);
            afirmar(await lanza(() => decryptToBlob(dek, a.ivHex, alterado.buffer)), 'aceptó un bit alterado');
            afirmar(await lanza(() => decryptToBlob(otra, a.ivHex, ct.buffer)), 'aceptó otra llave');
            afirmar(await lanza(() => decryptToBlob(dek, ivMalo, ct.buffer)), 'aceptó otro IV');
            afirmar(await lanza(() => decryptToBlob(dek, a.ivHex, ct.slice(0, -1).buffer)), 'aceptó una etiqueta truncada');
            [dek, otra].forEach(wipe);
            return '4 manipulaciones rechazadas por la etiqueta de autenticación';
        },
    },
    {
        id: 'CLT-06',
        titulo: 'Metadatos del activo cifrado que usa la cuota',
        req: 'RF-005',
        fn: async () => {
            const dek = trackSecret(crypto.getRandomValues(new Uint8Array(32)));
            for (const n of [0, 1, 1000, 3 * MiB + 7]) {
                const a = await encryptFile(dek, archivo(n));
                afirmar(a.tamanoBytes === n, `tamaño en claro incorrecto para ${n}`);
                afirmar(a.tamanoCifrado === n + 16 && a.ciphertext.size === n + 16, `tamaño cifrado incorrecto para ${n}`);
            }
            wipe(dek);
            return 'tamaño cifrado = tamaño + 16 bytes para 0 B, 1 B, 1 000 B y 3 MiB';
        },
    },
    {
        id: 'CLT-07',
        titulo: 'Fragmentación y verificación de la llave con el motor WebAssembly',
        req: 'RF-009, RF-015',
        fn: async () => {
            const dek = await deriveDEK('frase', randomSaltHex(), 1000);
            const r = await splitKey(dek, 10, 6);
            const xs = r.shares.map((s) => s.id);
            afirmar(r.shares.length === 10 && new Set(xs).size === 10, 'no hay 10 coordenadas distintas');
            afirmar(xs.every((x) => x >= 1 && x <= 65535), 'coordenada fuera de [1, 65535]');
            afirmar(r.commitmentsHex.length === 6 * 33 * 2, 'no hay 6 compromisos de 33 bytes');
            for (const s of r.shares) afirmar(await verifyShare(s, r.commitmentsHex), `fragmento ${s.id} rechazado`);
            const malo: Share = { id: r.shares[0].id, y: r.shares[0].y.slice() };
            malo.y[31] ^= 0x01;
            afirmar(!(await verifyShare(malo, r.commitmentsHex)), 'aceptó un fragmento alterado');
            afirmar(!(await verifyShare({ id: 999, y: r.shares[0].y }, r.commitmentsHex)), 'aceptó otra coordenada');
            afirmar(iguales(await recoverKey(r.shares.slice(4)), dek), 'no se recuperó con 6 fragmentos');
            afirmar(iguales(await recoverKey(r.shares), dek), 'no se recuperó con 10 fragmentos');
            afirmar(!iguales(await recoverKey(r.shares.slice(0, 5)), dek), '5 fragmentos reconstruyeron la llave');
            afirmar(await lanza(() => recoverKey([r.shares[0], r.shares[0], r.shares[1]])), 'aceptó coordenadas repetidas');
            wipe(dek);
            r.shares.forEach((s) => wipe(s.y));
            return 'n = 10, k = 6: 10/10 válidos; alterado rechazado; k reconstruyen y k - 1 no';
        },
    },
    {
        id: 'CLT-08',
        titulo: 'Formato de exportación compatible con la línea de comandos',
        req: 'RNF-007',
        fn: async () => {
            const y = crypto.getRandomValues(new Uint8Array(32));
            const texto = await encodeShareFile(4321, y);
            afirmar(texto === `.:SSS-KEY:.\n4321:${toHex(y)}\n.:END-SSS-KEY:.\n`, 'formato .sss distinto del de la herramienta');
            const ida = await decodeShareFile(texto);
            afirmar(ida.id === 4321 && iguales(ida.y, y), 'la lectura no invierte la escritura');
            const files = await motorArchivos();
            const { k, commitments } = files.decodeCommitments(COMPROMISOS_CLI);
            afirmar(k === 3, 'K del archivo .fss distinto de 3');
            const cmHex = toHex(commitments);
            const cli = await Promise.all(PARTICIPACIONES_CLI.map((t) => decodeShareFile(t)));
            for (const s of cli) afirmar(await verifyShare(s, cmHex), `participación ${s.id} de la CLI rechazada`);
            afirmar(toHex(await recoverKey(cli.slice(1, 4))) === SECRETO_CLI, 'no se recuperó el secreto de la CLI');
            afirmar(await lanza(() => decodeShareFile('.:SSS-KEY:.\n0:00\n.:END-SSS-KEY:.\n')), 'aceptó x = 0');
            afirmar(await lanza(() => decodeShareFile('4321:' + toHex(y))), 'aceptó un archivo sin bloque');
            afirmar(
                (() => {
                    try {
                        files.decodeCommitments(COMPROMISOS_CLI.replace('V:2', 'V:1'));
                        return false;
                    } catch {
                        return true;
                    }
                })(),
                'aceptó un .fss de versión 1',
            );
            return '5 participaciones de la CLI válidas en el navegador; secreto de la CLI recuperado con 3';
        },
    },
    {
        id: 'CLT-09',
        titulo: 'Cifrado de fragmentos hacia la sesión de recuperación (X25519 y AES-256-GCM)',
        req: 'RF-013, RF-014',
        fn: async () => {
            const env = bpKdfEnvelope(randomSaltHex());
            env.params.iterations = 1000; // la derivación completa se mide aparte
            const bp = await deriveBpKeypair('frase del beneficiario', env);
            const bp2 = await deriveBpKeypair('frase del beneficiario', env);
            const ajeno = await deriveBpKeypair('otra frase', env);
            afirmar(bp.publicKeyHex === bp2.publicKeyHex && /^[0-9a-f]{64}$/.test(bp.publicKeyHex), 'el par no es determinista');
            afirmar(bp.publicKeyHex !== ajeno.publicKeyHex, 'frases distintas dieron el mismo par');
            const share: Share = { id: 101, y: crypto.getRandomValues(new Uint8Array(32)) };
            const c1 = await cifrarFragmento(share, bp.publicKeyHex);
            const c2 = await cifrarFragmento(share, bp.publicKeyHex);
            afirmar(c1.epkHex !== c2.epkHex && c1.ciphertextHex !== c2.ciphertextHex, 'cifrados repetidos del mismo fragmento');
            afirmar(!c1.ciphertextHex.includes(toHex(share.y)), 'el cifrado contiene el fragmento');
            const dep = { xFragmento: share.id, ...c1 };
            const de = await descifrarFragmento(dep, bp.privateKey);
            afirmar(de.id === 101 && iguales(de.y, share.y), 'el beneficiario no recupera el fragmento');
            afirmar(await lanza(() => descifrarFragmento(dep, ajeno.privateKey)), 'otra llave descifró el fragmento');
            const alterado = { ...dep, ciphertextHex: (dep.ciphertextHex[0] === '0' ? '1' : '0') + dep.ciphertextHex.slice(1) };
            afirmar(await lanza(() => descifrarFragmento(alterado, bp.privateKey)), 'aceptó un depósito alterado');
            [bp.privateKey, bp2.privateKey, ajeno.privateKey, de.y].forEach(wipe);
            return 'par determinista; llave efímera distinta por fragmento; otra llave y depósito alterado rechazados';
        },
    },
    {
        id: 'CLT-10',
        titulo: 'Borrado del material sensible en memoria',
        req: 'RNF-001',
        fn: async () => {
            purgeAll();
            const dek = await deriveDEK('frase', randomSaltHex(), 1000);
            const r = await splitKey(dek, 3, 2);
            afirmar(pendingSecrets() === 4, `se esperaban 4 secretos registrados, hay ${pendingSecrets()}`);
            wipe(dek);
            afirmar(dek.every((b) => b === 0) && pendingSecrets() === 3, 'wipe no puso la llave en cero');
            const n = purgeAll();
            afirmar(n === 3 && pendingSecrets() === 0, 'purgeAll no borró los fragmentos');
            afirmar(r.shares.every((s) => s.y.every((b) => b === 0)), 'quedaron fragmentos sin borrar');
            return 'la llave y los 3 fragmentos se registran y quedan en cero al borrar';
        },
    },
];

// ── Mediciones ───────────────────────────────────────────────────────

interface Medicion {
    id: string;
    reps: number;
    lote: number;
    media_ms: number;
    de_ms: number;
    min_ms: number;
    max_ms: number;
}

/** `reps` muestras; cada una mide `lote` ejecuciones seguidas y se divide entre `lote`. */
async function medir(id: string, reps: number, lote: number, fn: () => Promise<unknown>, prep?: () => Promise<void>): Promise<Medicion> {
    await fn(); // calentamiento
    const t: number[] = [];
    for (let i = 0; i < reps; i++) {
        if (prep) await prep();
        const t0 = performance.now();
        for (let j = 0; j < lote; j++) await fn();
        t.push((performance.now() - t0) / lote);
    }
    const media = t.reduce((a, b) => a + b, 0) / reps;
    const de = Math.sqrt(t.reduce((a, b) => a + (b - media) ** 2, 0) / (reps - 1));
    return { id, reps, lote, media_ms: media, de_ms: de, min_ms: Math.min(...t), max_ms: Math.max(...t) };
}

async function mediciones(enviar: (parcial: Medicion[]) => Promise<void>): Promise<Medicion[]> {
    const out: Medicion[] = [];
    const push = async (m: Medicion) => {
        out.push(m);
        await enviar(out);
    };
    const dek = trackSecret(crypto.getRandomValues(new Uint8Array(32)));

    // Sal nueva en cada derivación, como en la app (una por bóveda o sesión):
    // repetir la misma entrada puede devolver un resultado reutilizado.
    await push(
        await medir('pbkdf2-600000', 10, 1, async () =>
            wipe(await deriveDEK('amplio-reto-cometa-dulce-fiel-granja-lunes-pieza', randomSaltHex())),
        ),
    );

    // Calentamiento del motor WebAssembly (compilación optimizada) antes de medir.
    const cal = await splitKey(dek, 20, 20);
    for (let i = 0; i < 10; i++) for (const s of cal.shares) await verifyShare(s, cal.commitmentsHex);
    cal.shares.forEach((s) => wipe(s.y));

    for (const [k, n] of [[9, 10], [10, 10], [19, 20], [20, 20]]) {
        const r = await splitKey(dek, n, k);
        await push(await medir(`wasm-split-${n}-${k}`, 20, 20, async () => (await splitKey(dek, n, k)).shares.forEach((s) => wipe(s.y))));
        await push(
            await medir(`wasm-verif-recup-${n}-${k}`, 20, 5, async () => {
                for (const s of r.shares) await verifyShare(s, r.commitmentsHex);
                wipe(await recoverKey(r.shares));
            }),
        );
        r.shares.forEach((s) => wipe(s.y));
    }

    for (const tam of [1, 10, 100, 1024]) {
        let f: File | null = archivo(tam * MiB);
        await push(await medir(`aes-cifrado-${tam}MiB`, 10, 1, async () => void (await encryptFile(dek, f!))));
        if (tam === 100) {
            const a = await encryptFile(dek, f);
            const ct = await a.ciphertext.arrayBuffer();
            await push(await medir('aes-descifrado-100MiB', 10, 1, async () => void (await decryptToBlob(dek, a.ivHex, ct))));
        }
        f = null;
    }
    wipe(dek);
    return out;
}

// ── Ejecución ────────────────────────────────────────────────────────

async function enviar(cuerpo: unknown) {
    const nav = new URLSearchParams(location.search).get('nav') ?? 'desconocido';
    await fetch(`/resultados?nav=${encodeURIComponent(nav)}`, { method: 'POST', body: JSON.stringify(cuerpo) });
}

async function main() {
    const suite = new URLSearchParams(location.search).get('suite') ?? 'todo';
    const info = {
        userAgent: navigator.userAgent,
        aislado: (self as any).crossOriginIsolated === true,
        brave: 'brave' in navigator, // Brave se presenta como Chrome en el agente de usuario
        fecha: new Date().toISOString(),
    };
    const log = document.getElementById('log')!;
    const resultados: any[] = [];
    if (suite !== 'bench') {
        for (const c of casos) {
            const t0 = performance.now();
            try {
                const detalle = await c.fn();
                resultados.push({ id: c.id, titulo: c.titulo, req: c.req, ok: true, ms: performance.now() - t0, detalle });
            } catch (e) {
                resultados.push({ id: c.id, titulo: c.titulo, req: c.req, ok: false, ms: performance.now() - t0, detalle: String(e) });
            }
            log.textContent += `${resultados.at(-1).ok ? 'OK   ' : 'FALLO'} ${c.id} ${c.titulo}\n`;
        }
        await enviar({ info, casos: resultados, completo: suite === 'clt' });
    }
    if (suite !== 'clt') {
        const med = await mediciones((parcial) => enviar({ info, casos: resultados, mediciones: parcial, completo: false }));
        await enviar({ info, casos: resultados, mediciones: med, completo: true });
        log.textContent += `mediciones: ${med.length}\n`;
    }
}

main().catch((e) => enviar({ error: String(e), completo: true }));
