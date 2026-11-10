/*
 * sss-files.js — codificación / decodificación de los formatos de archivo
 * .sss (share) y .fss (compromisos Feldman), byte a byte idénticos a los
 * que produce y lee el CLI nativo (src/sssio.c).
 *
 *   share_<x>.sss
 *     .:SSS-KEY:.
 *     <x>:<y_hex>            (x ∈ [1,65535]; y_hex = 32 B big-endian)
 *     .:END-SSS-KEY:.
 *
 *   commitments.fss  (versión 2)
 *     .:FELDMAN-COMMIT:.
 *     V:2
 *     K:<k>
 *     <j>:<C_hex>            (C_hex = punto comprimido SEC1, 33 B)
 *     .:END-FELDMAN-COMMIT:.
 *
 * Author : Erreguin F. Yair
 * License: MIT
 */

const SHARE_HEADER  = '.:SSS-KEY:.';
const SHARE_FOOTER  = '.:END-SSS-KEY:.';
const COMMIT_HEADER = '.:FELDMAN-COMMIT:.';
const COMMIT_FOOTER = '.:END-FELDMAN-COMMIT:.';
const FSS_VERSION   = 2;

export const toHex = (u8) =>
  [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');

export function fromHexExact(hex, nbytes) {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length !== nbytes * 2)
    throw new Error(`se esperaban ${nbytes * 2} caracteres hex`);
  const out = new Uint8Array(nbytes);
  for (let i = 0; i < nbytes; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* Escalar de 32 B big-endian; tolera hex más corto o en mayúsculas, como
 * el lector en C (hex_decode_scalar_be). */
export function scalarFromHex(hex) {
  const t = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(t) || t.length > 64)
    throw new Error('y_hex inválido');
  return fromHexExact(t.padStart(64, '0'), 32);
}

/* ── Share ── */

export function encodeShare(id, y) {
  return `${SHARE_HEADER}\n${id}:${toHex(y)}\n${SHARE_FOOTER}\n`;
}

export function decodeShare(text) {
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === SHARE_HEADER) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (line === SHARE_FOOTER) break;
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) throw new Error('línea de share sin ":"');
    const id = Number(line.slice(0, idx));
    if (!Number.isInteger(id) || id < 1 || id > 65535)
      throw new Error(`x fuera de [1, 65535]: "${line.slice(0, idx)}"`);
    return { id, y: scalarFromHex(line.slice(idx + 1)) };
  }
  throw new Error('no contiene un bloque .:SSS-KEY:.');
}

/* ── Compromisos ── */

export function encodeCommitments(commitments, k) {
  let out = `${COMMIT_HEADER}\nV:${FSS_VERSION}\nK:${k}\n`;
  for (let j = 0; j < k; j++)
    out += `${j}:${toHex(commitments.subarray(j * 33, j * 33 + 33))}\n`;
  return out + `${COMMIT_FOOTER}\n`;
}

export function decodeCommitments(text) {
  let inBlock = false, version = 0, k = 0, cm = null;
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === COMMIT_HEADER) { inBlock = true; continue; }
    if (!inBlock) continue;
    if (line === COMMIT_FOOTER) break;
    if (line.startsWith('V:')) { version = Number(line.slice(2)); continue; }
    if (line.startsWith('K:')) {
      if (version !== FSS_VERSION)
        throw new Error(`formato .fss no soportado (V:${version}, se esperaba V:${FSS_VERSION})`);
      k = Number(line.slice(2));
      if (!Number.isInteger(k) || k < 1 || k > 65535) throw new Error('K inválido');
      cm = new Uint8Array(k * 33);
      continue;
    }
    if (!cm || !line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const j = Number(line.slice(0, idx));
    if (!Number.isInteger(j) || j < 0 || j >= k) continue;
    if (seen.has(j)) throw new Error(`compromiso duplicado j=${j}`);
    cm.set(fromHexExact(line.slice(idx + 1), 33), j * 33);
    seen.add(j);
  }
  if (!cm || seen.size !== k)
    throw new Error('no contiene un bloque .:FELDMAN-COMMIT:. completo');
  return { k, commitments: cm };
}

/* ── Utilidades ── */

export function classifyText(text) {
  if (text.includes(COMMIT_HEADER)) return 'fss';
  if (text.includes(SHARE_HEADER))  return 'sss';
  return 'unknown';
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
