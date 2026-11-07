import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dmsService } from '../services/dms.service';
import { useAuth } from '../store/AuthContext';
import { useNotice } from '../store/NoticeContext';
import { getApiErrorMessage } from '../utils/errors';
import type { LiberacionResumenResponse } from '../types/dms.types';
import './PatrimonioLiberado.css';

function fmtFechaHora(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const MOTIVO_TITULO: Record<string, string> = {
    fallecimiento_confirmado: 'Tus custodios confirmaron el fallecimiento',
    limite_reconfirmaciones: 'Se agotaron las reconfirmaciones de vida permitidas',
    tiempo_agotado: 'Se agotó el plazo del protocolo de vida',
};

const SENTIDO_LABEL: Record<string, { texto: string; icono: string; color: string }> = {
    vida: { texto: 'Confirmó vida', icono: 'fa-heart-pulse', color: 'var(--success-green, #2ecc71)' },
    fallecimiento: { texto: 'Confirmó fallecimiento', icono: 'fa-heart-crack', color: 'var(--danger-red, #ef4444)' },
};

export default function PatrimonioLiberado() {
    const navigate = useNavigate();
    const { logout } = useAuth();

    const [resumen, setResumen] = useState<LiberacionResumenResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const { notifyError } = useNotice();

    useEffect(() => {
        let cancelled = false;
        dmsService
            .getLiberacionResumen()
            .then((r) => {
                if (cancelled) return;
                if (!r.liberado) {
                    // Se llegó aquí sin que aplique (ya no está liberado, o
                    // nunca lo estuvo): no hay nada que mostrar.
                    navigate('/dashboard', { replace: true });
                    return;
                }
                setResumen(r);
            })
            .catch((e) => {
                if (!cancelled) notifyError(getApiErrorMessage(e, 'No se pudo cargar el resumen.'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [navigate]);

    return (
        <div className="patrimonio-lib-page">
            <div className="patrimonio-lib-card">
                <div className="patrimonio-lib-bar" />
                <div className="p-5">
                    <div className="text-center mb-3 text-danger">
                        <i className="fas fa-heart-crack fa-3x" />
                    </div>
                    <h3 className="fw-bold text-center mb-2">Tu patrimonio digital ya fue liberado</h3>

                    {loading && <p className="text-muted text-center">Cargando resumen…</p>}

                    {resumen && (
                        <>
                            <p className="text-muted text-center mb-4">
                                {resumen.motivo ? MOTIVO_TITULO[resumen.motivo] : 'El Interruptor de Hombre Muerto se activó.'}{' '}
                                Tus bóvedas pasaron a recuperación para que tus custodios puedan acceder con sus
                                fragmentos.
                            </p>

                            <div className="bg-light p-3 rounded-3 mb-4 text-start">
                                <p className="patrimonio-lib-label mb-1">Qué pasó</p>
                                <p className="m-0 small">{resumen.motivo_detalle}</p>
                            </div>

                            <p className="patrimonio-lib-label mb-2">Línea de tiempo</p>
                            <div className="patrimonio-lib-timeline mb-4">
                                <div className="patrimonio-lib-timeline-item">
                                    <p className="m-0 small fw-bold">Entró en alerta por inactividad</p>
                                    <p className="m-0 small text-muted">{fmtFechaHora(resumen.alerta_en)}</p>
                                </div>
                                <div className="patrimonio-lib-timeline-item">
                                    <p className="m-0 small fw-bold">Pasó a periodo de gracia (se abrió la votación de custodios)</p>
                                    <p className="m-0 small text-muted">{fmtFechaHora(resumen.gracia_en)}</p>
                                </div>
                                <div className="patrimonio-lib-timeline-item">
                                    <p className="m-0 small fw-bold text-danger">Patrimonio liberado</p>
                                    <p className="m-0 small text-muted">{fmtFechaHora(resumen.liberado_en)}</p>
                                </div>
                            </div>

                            {resumen.quorum !== null && (
                                <p className="text-muted small mb-3">
                                    Se necesitaban <strong>{resumen.quorum}</strong> de{' '}
                                    <strong>{resumen.total_custodios}</strong> custodio(s) para confirmar en cada
                                    ronda
                                    {resumen.max_reconfirmaciones > 0 && (
                                        <>
                                            {' '}
                                            · reconfirmaciones de vida usadas:{' '}
                                            <strong>
                                                {resumen.reconfirmaciones}/{resumen.max_reconfirmaciones}
                                            </strong>
                                        </>
                                    )}
                                    .
                                </p>
                            )}

                            {resumen.rondas.length > 0 && (
                                <>
                                    <p className="patrimonio-lib-label mb-2">Votos de tus custodios</p>
                                    <div className="d-flex flex-column gap-3 mb-4">
                                        {resumen.rondas.map((r) => (
                                            <div className="patrimonio-lib-ronda" key={r.ronda}>
                                                <p className="m-0 small fw-bold mb-1">Ronda {r.ronda}</p>
                                                {r.votos.map((v, i) => {
                                                    const s = v.sentido ? SENTIDO_LABEL[v.sentido] : null;
                                                    return (
                                                        <div className="patrimonio-lib-voto-row" key={`${r.ronda}-${i}`}>
                                                            <span>{v.custodio_nombre}</span>
                                                            {s ? (
                                                                <span style={{ color: s.color, fontWeight: 700 }}>
                                                                    <i className={`fas ${s.icono} me-1`} />
                                                                    {s.texto} · {fmtFechaHora(v.votado_en)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-muted">Sin respuesta</span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            <p className="text-muted small text-center mb-4">
                                Si esto es un error y sigues con vida, contacta a soporte para revisar tu caso —
                                iniciar sesión ya no revierte automáticamente un patrimonio liberado.
                            </p>

                            <div className="d-grid">
                                <button
                                    className="btn btn-ipn rounded-pill py-2"
                                    onClick={() => {
                                        // El panel queda bloqueado de forma permanente una vez
                                        // liberado el patrimonio: no hay "continuar", solo cerrar
                                        // sesión y volver al login (ProtectedRoute igual impediría
                                        // el acceso, pero no tiene sentido dejar la sesión abierta).
                                        logout();
                                        navigate('/login', { replace: true });
                                    }}
                                >
                                    Entiendo <i className="fas fa-arrow-right ms-2" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
