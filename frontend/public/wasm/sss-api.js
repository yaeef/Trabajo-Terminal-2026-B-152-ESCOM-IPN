/*
 * sss-api.js — envoltorio ergonómico sobre el módulo WebAssembly.
 *
 * Compila el .wasm con:  make wasm
 * (produce web/sss.js + web/sss.wasm; este archivo NO se genera, se
 *  escribe a mano y usa las funciones "planas" exportadas de sss.h.)
 *
 * Uso:
 *   import createSSSModule from './sss.js';
 *   import { SSS } from './sss-api.js';
 *
 *   const sss = await SSS.load(createSSSModule);
 *   const secret = crypto.getRandomValues(new Uint8Array(32));  // 0 < s < N
 *   const { shares, commitments } = sss.split(secret, 5, 3, { feldman: true });
 *   const back = sss.recover(shares.filter((_, i) => [0, 2, 4].includes(i)));
 *   const ok  = sss.verify(shares[1], commitments);
 *
 * Por defecto las coordenadas x (share.id) son aleatorias, distintas y
 * uniformes en [1, 65535]. Con { seqIds: true } se usan 1..n.
 *
 * Formatos:
 *   share       = { id: number, y: Uint8Array(32) }
 *   commitments = Uint8Array(k * 33)   (puntos comprimidos SEC1)
 *
 * Author : Erreguin F. Yair
 * License: MIT
 */

const SCALAR = 32;
const POINT = 33;
const SSS_SPLIT_SEQ_IDS = 1;

export class SSS {
  #m;        // módulo Emscripten
  #ctx;      // puntero a sss_context

  constructor(module) {
    this.#m = module;
    this.#ctx = module._sss_context_create_default();
    if (!this.#ctx) throw new Error('sss_context_create_default falló');
  }

  /** Carga el módulo wasm y devuelve una instancia lista. */
  static async load(factory) {
    const module = await factory();
    return new SSS(module);
  }

  /** Libera el contexto nativo. */
  destroy() {
    if (this.#ctx) {
      this.#m._sss_context_destroy(this.#ctx);
      this.#ctx = 0;
    }
  }

  #alloc(bytes) {
    const p = this.#m._malloc(bytes);
    if (!p) throw new Error('malloc falló');
    return p;
  }

  /**
   * Divide `secret` (Uint8Array de 32 bytes, 0 < s < N) en `n` shares con
   * umbral `k`. Con { feldman: true } devuelve también los compromisos.
   * Las coordenadas x son aleatorias por defecto; { seqIds: true } → 1..n.
   * @returns {{ shares: {id:number,y:Uint8Array}[], commitments: Uint8Array|null }}
   */
  split(secret, n, k, { feldman = false, seqIds = false } = {}) {
    if (!(secret instanceof Uint8Array) || secret.length !== SCALAR)
      throw new Error('secret debe ser Uint8Array(32)');
    if (!(k >= 2 && n >= k && n <= 65535))
      throw new Error('parámetros n/k inválidos');

    const m = this.#m;
    const flags = seqIds ? SSS_SPLIT_SEQ_IDS : 0;
    const pSecret = this.#alloc(SCALAR);
    const pIds = this.#alloc(n * 4);
    const pYs = this.#alloc(n * SCALAR);
    const pCommit = feldman ? this.#alloc(k * POINT) : 0;

    try {
      m.HEAPU8.set(secret, pSecret);
      const rc = m._sss_split_flat(this.#ctx, pSecret, n, k, pIds, pYs, pCommit, flags);
      if (rc !== 1) throw new Error('sss_split_flat falló (secret fuera de rango o RNG)');

      const shares = [];
      for (let i = 0; i < n; i++) {
        shares.push({
          id: m.HEAPU32[(pIds >> 2) + i],
          y: m.HEAPU8.slice(pYs + i * SCALAR, pYs + (i + 1) * SCALAR),
        });
      }
      const commitments = feldman
        ? m.HEAPU8.slice(pCommit, pCommit + k * POINT)
        : null;
      return { shares, commitments };
    } finally {
      // Cero el scratch con material sensible (secreto + shares) antes de liberar.
      m.HEAPU8.fill(0, pSecret, pSecret + SCALAR);
      m.HEAPU8.fill(0, pYs, pYs + n * SCALAR);
      m._free(pSecret);
      m._free(pIds);
      m._free(pYs);
      if (pCommit) m._free(pCommit);
    }
  }

  /**
   * Reconstruye el secreto desde `shares` (>= k elementos {id, y}).
   * @returns {Uint8Array} 32 bytes big-endian
   */
  recover(shares) {
    const count = shares.length;
    if (count < 2) throw new Error('se necesitan >= 2 shares');

    const m = this.#m;
    const pIds = this.#alloc(count * 4);
    const pYs = this.#alloc(count * SCALAR);
    const pOut = this.#alloc(SCALAR);

    try {
      for (let i = 0; i < count; i++) {
        m.HEAPU32[(pIds >> 2) + i] = shares[i].id >>> 0;
        m.HEAPU8.set(shares[i].y, pYs + i * SCALAR);
      }
      const rc = m._sss_recover_flat(this.#ctx, count, pIds, pYs, pOut);
      if (rc !== 1) throw new Error('sss_recover_flat falló (ids duplicados o share inválido)');
      return m.HEAPU8.slice(pOut, pOut + SCALAR);
    } finally {
      // Cero el scratch con material sensible (shares + secreto reconstruido).
      m.HEAPU8.fill(0, pYs, pYs + count * SCALAR);
      m.HEAPU8.fill(0, pOut, pOut + SCALAR);
      m._free(pIds);
      m._free(pYs);
      m._free(pOut);
    }
  }

  /**
   * Verifica `share` ({id, y}) contra `commitments` (Uint8Array de k*33).
   * @returns {boolean}
   */
  verify(share, commitments) {
    if (!(commitments instanceof Uint8Array) || commitments.length % POINT !== 0)
      throw new Error('commitments debe ser Uint8Array(k*33)');
    const k = commitments.length / POINT;

    const m = this.#m;
    const pY = this.#alloc(SCALAR);
    const pCommit = this.#alloc(commitments.length);

    try {
      m.HEAPU8.set(share.y, pY);
      m.HEAPU8.set(commitments, pCommit);
      return m._sss_feldman_verify_flat(this.#ctx, share.id >>> 0, pY, pCommit, k) === 1;
    } finally {
      m.HEAPU8.fill(0, pY, pY + SCALAR); // `y` del share es sensible
      m._free(pY);
      m._free(pCommit);
    }
  }
}
