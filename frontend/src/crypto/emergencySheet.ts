// src/crypto/emergencySheet.ts
//
// Genera una "hoja de emergencia" imprimible con una pass-phrase. 100%
// cliente — nunca toca el servidor. Hay dos variantes con el mismo formato:
//
//   - 'boveda': la pass-phrase de la bóveda, al crearla. Respaldo físico
//     para el caso "el propietario vive pero olvidó la frase" (sin frase y
//     sin recuperación por custodios, los activos son irrecuperables).
//   - 'sesion': la pass-phrase de sesión del Beneficiario Principal, al
//     fundar una sesión de recuperación. Sin ella no puede reingresar a la
//     sesión (el servidor solo guarda su llave pública).
//
// En ambos casos la descarga es obligatoria. El archivo es HTML autónomo
// con estilos de impresión.

import { parseBackendDate } from '../utils/dates';

interface HojaBoveda {
    tipo: 'boveda';
    nombreBoveda: string;
    pid: string;
    passphrase: string;
}

interface HojaSesion {
    tipo: 'sesion';
    nombreBoveda: string;
    pid: string;
    passphrase: string;
    /** Coordenada x del fragmento con el que se fundó la sesión. */
    xFragmento: number;
    /** `expira_en` de la sesión tal como lo devuelve el backend (UTC sin zona). */
    expiraEn: string | null;
}

export type SheetOpts = HojaBoveda | HojaSesion;

const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));

const fmtFecha = (d: Date) => d.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' });

interface Contenido {
    titulo: string;
    subtitulo: string;
    etiquetaFrase: string;
    advertencia: string;
    campos: Array<[string, string]>;
    usos: string[];
    archivo: string;
}

function contenido(o: SheetOpts): Contenido {
    if (o.tipo === 'boveda') {
        return {
            titulo: 'Hoja de emergencia · Kleimos Legacy',
            subtitulo: `Bóveda “<strong>${esc(o.nombreBoveda)}</strong>”`,
            etiquetaFrase: 'Pass-phrase de la bóveda',
            advertencia:
                'Cualquiera con esta hoja puede descifrar los activos de la bóveda. Imprímela y guárdala en ' +
                'un lugar físico seguro (caja fuerte, caja de seguridad bancaria). <b>No la guardes en la nube, ' +
                'no le tomes foto, no la envíes por mensaje o correo.</b>',
            campos: [['Identificador público (PID)', esc(o.pid)]],
            usos: [
                'De esta frase se deriva la llave AES-256 que cifra los activos de la bóveda.',
                'Si la olvidas, <b>solo</b> podrás recuperar los activos mediante el proceso de ' +
                    'recuperación con custodios (reconstrucción del secreto por Shamir).',
                'El servidor de Kleimos nunca conoce esta frase ni la llave: por eso este respaldo es ' +
                    'tu única copia si decides no memorizarla.',
            ],
            archivo: `hoja-emergencia-${o.pid}.html`,
        };
    }
    const expira = o.expiraEn ? fmtFecha(parseBackendDate(o.expiraEn)) : null;
    return {
        titulo: 'Hoja de emergencia · Sesión de recuperación',
        subtitulo: `Bóveda “<strong>${esc(o.nombreBoveda)}</strong>” — eres el Beneficiario Principal`,
        etiquetaFrase: 'Pass-phrase de sesión',
        advertencia:
            'Con esta pass-phrase y tu fragmento se puede entrar a la sesión como Beneficiario Principal y ' +
            'recibir los fragmentos de los demás custodios. Guárdala en un lugar físico seguro. ' +
            '<b>No la compartas con nadie, tampoco con los otros custodios.</b>',
        campos: [
            ['Identificador público (PID)', esc(o.pid)],
            ['Tu fragmento', `x = ${o.xFragmento}`],
            ...(expira ? ([['La sesión expira', esc(expira)]] as Array<[string, string]>) : []),
        ],
        usos: [
            'Para volver a la sesión desde cualquier dispositivo: abre el portal de recuperación, busca ' +
                'la bóveda por su PID, sube tu fragmento (.sss) e ingresa esta pass-phrase.',
            'No es la pass-phrase de la bóveda: solo protege tu llave de sesión, con la que se ' +
                'descifran los fragmentos que aportan los demás custodios.',
            'El servidor de Kleimos no la conoce (solo guarda tu llave pública): si la pierdes, no podrás ' +
                'reingresar, y cuando la sesión expire otro custodio tendrá que fundar una nueva.',
        ],
        archivo: `hoja-sesion-recuperacion-${o.pid}.html`,
    };
}

function buildHtml(o: SheetOpts, c: Contenido): string {
    const fecha = new Date().toLocaleString('es-MX');
    const campos = c.campos
        .map(([label, valor]) => `
    <div class="field">
      <div class="label">${label}</div>
      <div class="kv">${valor}</div>
    </div>`)
        .join('');
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${c.titulo} — ${esc(o.nombreBoveda)}</title>
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
  .muted { color: #64748b; font-size: .85rem; }
  .warn { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412;
          border-radius: 12px; padding: 14px 16px; font-size: .9rem; margin: 20px 0; }
  .warn strong { display:block; margin-bottom: 4px; }
  .field { margin: 16px 0; }
  .label { font-size: .7rem; font-weight: 800; letter-spacing: 1px;
           text-transform: uppercase; color: #94a3b8; margin-bottom: 6px; }
  .phrase { font-family: ui-monospace, "JetBrains Mono", Menlo, monospace;
            font-size: 1.15rem; font-weight: 700; letter-spacing: .5px; color: #003366;
            background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 10px;
            padding: 14px 16px; word-break: break-all; }
  .kv { font-family: ui-monospace, monospace; font-size: .82rem; color: #475569; }
  ol { font-size: .9rem; color: #334155; padding-left: 20px; }
  ol li { margin: 6px 0; }
  .foot { border-top: 1px solid #e2e8f0; padding: 16px 32px; font-size: .72rem; color: #94a3b8; }
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
    <h1>${c.titulo}</h1>
    <p class="muted">${c.subtitulo} — generada el ${esc(fecha)}</p>

    <div class="warn">
      <strong>⚠ Documento altamente sensible</strong>
      ${c.advertencia}
    </div>

    <div class="field">
      <div class="label">${c.etiquetaFrase}</div>
      <div class="phrase">${esc(o.passphrase)}</div>
    </div>
${campos}

    <div class="field">
      <div class="label">Para qué sirve</div>
      <ol>
        ${c.usos.map((u) => `<li>${u}</li>`).join('\n        ')}
      </ol>
    </div>

    <button class="noprint" onclick="window.print()"
      style="margin-top:8px;padding:10px 18px;border:none;border-radius:50px;background:#621132;color:#fff;font-weight:600;cursor:pointer">
      Imprimir
    </button>
  </div>
  <div class="foot">Kleimos Legacy · ESCOM-IPN · Este archivo no se sincroniza con ningún servidor.</div>
</div>
</body></html>`;
}

export function downloadEmergencySheet(o: SheetOpts): void {
    const c = contenido(o);
    const blob = new Blob([buildHtml(o, c)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: c.archivo });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
}
