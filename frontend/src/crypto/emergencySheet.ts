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
import { getLang, locale, t } from '../i18n';

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

const fmtFecha = (d: Date) => d.toLocaleString(locale(), { dateStyle: 'long', timeStyle: 'short' });

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
            titulo: t('Hoja de emergencia · Kleimos Legacy', 'Emergency sheet · Kleimos Legacy'),
            subtitulo: `${t('Bóveda', 'Vault')} “<strong>${esc(o.nombreBoveda)}</strong>”`,
            etiquetaFrase: t('Llave maestra de la bóveda', 'Vault master key'),
            advertencia: t(
                'Cualquiera con esta hoja puede abrir los archivos de la bóveda. Imprímela y guárdala en ' +
                    'un lugar físico seguro (caja fuerte, caja de seguridad bancaria). <b>No la guardes en la nube, ' +
                    'no le tomes foto, no la envíes por mensaje o correo.</b>',
                "Anyone with this sheet can open the vault's files. Print it and keep it in " +
                    "a secure physical place (safe, bank safe-deposit box). <b>Don't store it in the cloud, " +
                    "don't photograph it, don't send it by message or email.</b>",
            ),
            campos: [[t('Código de la bóveda', 'Vault code'), esc(o.pid)]],
            usos: [
                t(
                    'Con esta llave maestra se protegen y se abren los archivos de la bóveda.',
                    "This master key protects and opens the vault's files.",
                ),
                t(
                    'Si la olvidas, <b>solo</b> podrás recuperar los archivos con la ayuda de tus custodios, ' +
                        'cuando se active la recuperación.',
                    'If you forget it, you can <b>only</b> recover the files with the help of your custodians, ' +
                        'once recovery is triggered.',
                ),
                t(
                    'Kleimos nunca conoce tu llave maestra: por eso esta hoja es tu única copia si decides no ' +
                        'memorizarla.',
                    'Kleimos never knows your master key: that is why this sheet is your only copy if you choose ' +
                        'not to memorize it.',
                ),
            ],
            archivo: `${t('hoja-emergencia', 'emergency-sheet')}-${o.pid}.html`,
        };
    }
    const expira = o.expiraEn ? fmtFecha(parseBackendDate(o.expiraEn)) : null;
    return {
        titulo: t('Hoja de emergencia · Sesión de recuperación', 'Emergency sheet · Recovery session'),
        subtitulo: t(
            `Bóveda “<strong>${esc(o.nombreBoveda)}</strong>” — eres el Beneficiario Principal`,
            `Vault “<strong>${esc(o.nombreBoveda)}</strong>” — you are the Primary Beneficiary`,
        ),
        etiquetaFrase: t('Clave de la sesión', 'Session key'),
        advertencia: t(
            'Con esta clave y tu fragmento se puede entrar a la sesión como Beneficiario Principal y ' +
                'recibir los fragmentos de los demás custodios. Guárdala en un lugar físico seguro. ' +
                '<b>No la compartas con nadie, tampoco con los otros custodios.</b>',
            'With this key and your share you can enter the session as Primary Beneficiary and ' +
                "receive the other custodians' shares. Keep it in a secure physical place. " +
                "<b>Don't share it with anyone, not even the other custodians.</b>",
        ),
        campos: [
            [t('Código de la bóveda', 'Vault code'), esc(o.pid)],
            ...(expira ? ([[t('La sesión expira', 'The session expires'), esc(expira)]] as Array<[string, string]>) : []),
        ],
        usos: [
            t(
                'Para volver a la sesión desde cualquier dispositivo: abre la página de recuperación, busca ' +
                    'la bóveda por su código, sube tu fragmento (.sss) y escribe esta clave.',
                'To return to the session from any device: open the recovery page, look up ' +
                    'the vault by its code, upload your share (.sss) and enter this key.',
            ),
            t(
                'No es la llave maestra de la bóveda: solo sirve para esta recuperación y para recibir los ' +
                    'fragmentos que entregan los demás custodios.',
                "It isn't the vault's master key: it only works for this recovery and to receive the " +
                    'shares the other custodians hand in.',
            ),
            t(
                'Kleimos no la conoce: si la pierdes, no podrás volver a entrar, y cuando la sesión venza otro ' +
                    'custodio tendrá que empezar una nueva.',
                "Kleimos doesn't know it: if you lose it, you won't be able to get back in, and when the session " +
                    'expires another custodian will have to start a new one.',
            ),
        ],
        archivo: `${t('hoja-sesion-recuperacion', 'recovery-session-sheet')}-${o.pid}.html`,
    };
}

function buildHtml(o: SheetOpts, c: Contenido): string {
    const fecha = new Date().toLocaleString(locale());
    const campos = c.campos
        .map(([label, valor]) => `
    <div class="field">
      <div class="label">${label}</div>
      <div class="kv">${valor}</div>
    </div>`)
        .join('');
    return `<!doctype html>
<html lang="${getLang()}"><head><meta charset="utf-8">
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
    <p class="muted">${c.subtitulo} — ${t('generada el', 'generated on')} ${esc(fecha)}</p>

    <div class="warn">
      <strong>⚠ ${t('Documento altamente sensible', 'Highly sensitive document')}</strong>
      ${c.advertencia}
    </div>

    <div class="field">
      <div class="label">${c.etiquetaFrase}</div>
      <div class="phrase">${esc(o.passphrase)}</div>
    </div>
${campos}

    <div class="field">
      <div class="label">${t('Para qué sirve', 'What it is for')}</div>
      <ol>
        ${c.usos.map((u) => `<li>${u}</li>`).join('\n        ')}
      </ol>
    </div>

    <button class="noprint" onclick="window.print()"
      style="margin-top:8px;padding:10px 18px;border:none;border-radius:50px;background:#621132;color:#fff;font-weight:600;cursor:pointer">
      ${t('Imprimir', 'Print')}
    </button>
  </div>
  <div class="foot">Kleimos Legacy · ESCOM-IPN · ${t('Este archivo no se sincroniza con ningún servidor.', "This file isn't synced with any server.")}</div>
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
