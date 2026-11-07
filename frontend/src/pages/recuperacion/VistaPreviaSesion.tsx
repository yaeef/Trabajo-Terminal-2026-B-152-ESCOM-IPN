import { useEffect, useState } from 'react';
import { parseBackendDate } from '../../utils/dates';
import type { FragmentoDepositadoResponse, SesionEstadoResponse } from '../../types/recuperacion.types';

/** Marca de tiempo que se refresca cada segundo mientras `activo` sea true. */
export function useReloj(activo: boolean): number {
    const [ahora, setAhora] = useState(() => Date.now());
    useEffect(() => {
        if (!activo) return;
        setAhora(Date.now());
        const t = window.setInterval(() => setAhora(Date.now()), 1000);
        return () => window.clearInterval(t);
    }, [activo]);
    return ahora;
}

/** Milisegundos que le quedan a la sesión (<= 0 si ya expiró; Infinity si no se sabe). */
export function restanteDeSesion(sesion: SesionEstadoResponse, ahora: number): number {
    return sesion.expira_en ? parseBackendDate(sesion.expira_en).getTime() - ahora : Infinity;
}

function formatoRestante(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d} d ${h} h ${m} min`;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min ${s % 60} s`;
}

const fmtFecha = (iso: string) =>
    parseBackendDate(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function FilaDeposito({ d, esBp }: { d: FragmentoDepositadoResponse; esBp?: boolean }) {
    return (
        <div className="sesion-preview-fila">
            <div className="flex-grow-1">
                <div className="small">
                    <span className="text-muted">Se registró como </span>
                    <strong>{d.nombre_declarado}</strong>
                    {!esBp && <span className="text-muted"> · {d.vinculo_declarado}</span>}
                </div>
                <div className="sesion-preview-detalle">
                    Fragmento <code>x={d.x_fragmento}</code> ·{' '}
                    {d.custodio_asignado ? (
                        <>
                            pertenece a <strong>{d.custodio_asignado}</strong>
                        </>
                    ) : (
                        <span className="text-danger">no está asignado a ningún custodio</span>
                    )}
                </div>
            </div>
            <div className="sesion-preview-hora" title="Se unió">
                {fmtFecha(d.depositado_en)}
            </div>
        </div>
    );
}

/**
 * Lo que ve un custodio que llega con un fragmento válido a una sesión ya
 * fundada, ANTES de decidir si se une: quién es el Beneficiario Principal,
 * quiénes ya aportaron (con el custodio al que el propietario asignó cada
 * fragmento y el nombre con el que se registró quien lo aportó) y cuánto
 * le queda a la sesión.
 */
export default function VistaPreviaSesion({
    sesion,
    restanteMs,
}: {
    sesion: SesionEstadoResponse;
    restanteMs: number;
}) {
    const fundador = sesion.depositos.find((d) => d.x_fragmento === sesion.x_fundador);
    const otros = sesion.depositos.filter((d) => d.x_fragmento !== sesion.x_fundador);
    const expirada = restanteMs <= 0;
    const urgente = !expirada && restanteMs < 60 * 60 * 1000;
    const k = sesion.umbral_k ?? 0;

    return (
        <div className="sesion-preview mb-3">
            <div className="d-flex justify-content-between align-items-center mb-1 gap-2 flex-wrap">
                <span className="recuperacion-label">Sesión de recuperación en curso</span>
                <span className={`sesion-reloj ${expirada ? 'is-expirada' : urgente ? 'is-urgente' : ''}`}>
                    <i className="fas fa-hourglass-half me-1" />
                    {expirada ? 'Expirada' : Number.isFinite(restanteMs) ? `Quedan ${formatoRestante(restanteMs)}` : 'Vigente'}
                </span>
            </div>
            <p className="small text-muted mb-3">
                {sesion.expira_en && <>Expira el {fmtFecha(sesion.expira_en)} · </>}
                {k > 0 && sesion.depositos.length >= k ? (
                    <>Ya se reunieron los <strong>{k}</strong> fragmentos necesarios.</>
                ) : (
                    <>
                        Llevan <strong>{sesion.depositos.length}</strong> de <strong>{k}</strong> fragmentos
                        necesarios.
                    </>
                )}
            </p>

            <div className="recuperacion-label mb-1">
                <i className="fas fa-crown me-1" /> Beneficiario Principal
            </div>
            {fundador ? (
                <FilaDeposito d={fundador} esBp />
            ) : (
                <p className="small text-muted">No se encontró el fragmento del fundador.</p>
            )}

            <div className="recuperacion-label mt-3 mb-1">Custodios que ya se unieron ({otros.length})</div>
            {otros.length === 0 ? (
                <p className="small text-muted m-0">Nadie más se ha unido todavía.</p>
            ) : (
                otros.map((d) => <FilaDeposito key={d.x_fragmento} d={d} />)
            )}
        </div>
    );
}
