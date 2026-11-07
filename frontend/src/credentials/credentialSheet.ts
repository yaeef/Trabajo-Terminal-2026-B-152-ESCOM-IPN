// src/credentials/credentialSheet.ts
//
// Genera una hoja imprimible (→ "Guardar como PDF" del navegador) con las
// credenciales de un activo de plantilla. 100% cliente: el JSON ya se
// descifró en memoria y aquí solo se maqueta. Nunca toca el servidor.
//
// Mismo patrón que crypto/emergencySheet.ts: HTML autónomo con estilos de
// impresión y un botón que llama a window.print().

import {
    campoEsSecreto,
    parseEnvelope,
    plantillaById,
    type CredentialEnvelope,
} from './templates';

interface SheetOpts {
    envelope: CredentialEnvelope;
    nombreActivo: string;
    bovedaNombre: string;
}

const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));

function buildHtml(o: SheetOpts): string {
    const plantilla = plantillaById(o.envelope.b152_plantilla);
    const titulo = plantilla?.label ?? 'Credenciales';
    const generada = new Date().toLocaleString('es-MX');
    const actualizado = (() => {
        try {
            return new Date(o.envelope.actualizado_en).toLocaleString('es-MX');
        } catch {
            return o.envelope.actualizado_en;
        }
    })();

    // Orden: el de la plantilla; los campos desconocidos van al final.
    const orden = plantilla?.campos ?? [];
    const vistos = new Set<string>();
    const filas: string[] = [];

    const push = (label: string, valor: string, secreto: boolean) => {
        if (!valor) return;
        const cls = secreto ? 'val secret' : 'val';
        filas.push(
            `<div class="field"><div class="label">${esc(label)}</div>` +
            `<div class="${cls}">${esc(valor)}</div></div>`,
        );
    };

    for (const c of orden) {
        vistos.add(c.key);
        const v = o.envelope.campos[c.key];
        if (v) push(c.label, v, campoEsSecreto(c));
    }
    for (const [k, v] of Object.entries(o.envelope.campos)) {
        if (!vistos.has(k) && v) push(k, v, true); // desconocido → se trata como sensible
    }

    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(o.nombreActivo)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
         color: #1e293b; background: #f8fafc; margin: 0; padding: 32px; }
  .sheet { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0;
           border-radius: 16px; overflow: hidden; }
  .bar { height: 8px; background: linear-gradient(90deg, #621132, #003366); }
  .pad { padding: 28px 32px; }
  h1 { font-size: 1.3rem; margin: 0 0 4px; }
  .muted { color: #64748b; font-size: .85rem; margin: 0 0 2px; }
  .warn { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412;
          border-radius: 12px; padding: 14px 16px; font-size: .9rem; margin: 20px 0; }
  .warn strong { display:block; margin-bottom: 4px; }
  .field { margin: 14px 0; }
  .label { font-size: .7rem; font-weight: 800; letter-spacing: 1px;
           text-transform: uppercase; color: #94a3b8; margin-bottom: 6px; }
  .val { font-size: .95rem; color: #1e293b; white-space: pre-wrap; word-break: break-word; }
  .val.secret { font-family: ui-monospace, "JetBrains Mono", Menlo, monospace;
                font-weight: 700; color: #003366; background: #f1f5f9;
                border: 1px dashed #cbd5e1; border-radius: 10px; padding: 12px 14px; }
  .foot { border-top: 1px solid #e2e8f0; padding: 16px 32px; font-size: .72rem; color: #94a3b8; }
  .btn { margin-top: 8px; padding: 10px 18px; border: none; border-radius: 50px;
         background: #621132; color: #fff; font-weight: 600; cursor: pointer; }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: none; border-radius: 0; }
    .noprint { display: none; }
  }
</style></head>
<body>
<div class="sheet">
  <div class="bar"></div>
  <div class="pad">
    <h1>${esc(titulo)} · B152</h1>
    <p class="muted">Activo “<strong>${esc(o.nombreActivo)}</strong>” — bóveda “${esc(o.bovedaNombre)}”</p>
    <p class="muted">Última edición: ${esc(actualizado)} · hoja generada el ${esc(generada)}</p>

    <div class="warn">
      <strong>⚠ Documento altamente sensible</strong>
      Contiene credenciales en claro. Imprímelo o guárdalo como PDF y ponlo en un lugar físico
      seguro. <b>No lo dejes en la nube, no le tomes foto, no lo envíes por mensaje o correo.</b>
    </div>

    ${filas.join('\n    ') || '<p class="muted">Esta plantilla no tiene campos con valor.</p>'}

    <button class="btn noprint" onclick="window.print()">Imprimir / Guardar como PDF</button>
  </div>
  <div class="foot">Trabajo Terminal B-152 · ESCOM-IPN · Este archivo no se sincroniza con ningún servidor.</div>
</div>
</body></html>`;
}

/** Abre la hoja en una pestaña nueva. Devuelve false si el navegador la bloqueó. */
export function openCredentialSheet(o: SheetOpts): boolean {
    const html = buildHtml(o);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
        URL.revokeObjectURL(url);
        return false;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
}

/** Igual, pero recibe el texto JSON crudo recién descifrado. */
export function openCredentialSheetFromJson(
    texto: string,
    nombreActivo: string,
    bovedaNombre: string,
): boolean {
    return openCredentialSheet({ envelope: parseEnvelope(texto), nombreActivo, bovedaNombre });
}