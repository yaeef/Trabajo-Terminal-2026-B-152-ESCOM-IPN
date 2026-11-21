import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dmsService } from '../services/dms.service';
import { useAuth } from '../store/AuthContext';
import { useNotice } from '../store/NoticeContext';
import { getApiErrorMessage } from '../utils/errors';
import type { LiberacionResumenResponse } from '../types/dms.types';
import './PatrimonioLiberado.css';
import LanguageToggle from '../components/common/LanguageToggle';
import { getLang, locale, t } from '../i18n';

function fmtFechaHora(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(locale(), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const motivoTitulo = (motivo: string): string | undefined =>
    ({
        fallecimiento_confirmado: t('Tus custodios confirmaron el fallecimiento', 'Your custodians confirmed your death'),
        limite_reconfirmaciones: t('Se agotaron las reconfirmaciones de vida permitidas', 'The allowed life reconfirmations ran out'),
        tiempo_agotado: t('Se agotó el plazo del protocolo de vida', 'The life protocol deadline ran out'),
    })[motivo];

const sentidoLabel = (sentido: string): { texto: string; icono: string; color: string } | undefined =>
    ({
        vida: { texto: t('Confirmó vida', 'Confirmed alive'), icono: 'fa-heart-pulse', color: 'var(--success-green, #2ecc71)' },
        fallecimiento: { texto: t('Confirmó fallecimiento', 'Confirmed death'), icono: 'fa-heart-crack', color: 'var(--danger-red, #ef4444)' },
    })[sentido];

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
                if (!cancelled) notifyError(getApiErrorMessage(e, t('No se pudo cargar el resumen.', "Couldn't load the summary.")));
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
            <div className="auth-theme-toggle">
                <LanguageToggle />
            </div>
            <div className="patrimonio-lib-card">
                <div className="patrimonio-lib-bar" />
                <div className="p-5">
                    <div className="text-center mb-3 text-danger">
                        <i className="fas fa-heart-crack fa-3x" />
                    </div>
                    <h3 className="fw-bold text-center mb-2">{t('Tu patrimonio digital ya fue liberado', 'Your digital estate has been released')}</h3>

                    {loading && <p className="text-muted text-center">{t('Cargando resumen…', 'Loading summary…')}</p>}

                    {resumen && (
                        <>
                            <p className="text-muted text-center mb-4">
                                {(resumen.motivo && motivoTitulo(resumen.motivo)) || t('El protocolo de vida se activó.', 'The life protocol was triggered.')}{' '}
                                {t(
                                    'Tus bóvedas pasaron a recuperación para que tus custodios puedan acceder con sus fragmentos.',
                                    'Your vaults moved to recovery so your custodians can access them with their shares.',
                                )}
                            </p>

                            <div className="bg-light p-3 rounded-3 mb-4 text-start">
                                <p className="patrimonio-lib-label mb-1">{t('Qué pasó', 'What happened')}</p>
                                <p className="m-0 small">{resumen.motivo_detalle}</p>
                            </div>

                            <p className="patrimonio-lib-label mb-2">{t('Línea de tiempo', 'Timeline')}</p>
                            <div className="patrimonio-lib-timeline mb-4">
                                <div className="patrimonio-lib-timeline-item">
                                    <p className="m-0 small fw-bold">{t('Entró en alerta por inactividad', 'Went on alert for inactivity')}</p>
                                    <p className="m-0 small text-muted">{fmtFechaHora(resumen.alerta_en)}</p>
                                </div>
                                <div className="patrimonio-lib-timeline-item">
                                    <p className="m-0 small fw-bold">{t('Pasó a periodo de gracia (se abrió la votación de custodios)', 'Entered the grace period (custodian voting opened)')}</p>
                                    <p className="m-0 small text-muted">{fmtFechaHora(resumen.gracia_en)}</p>
                                </div>
                                <div className="patrimonio-lib-timeline-item">
                                    <p className="m-0 small fw-bold text-danger">{t('Patrimonio liberado', 'Estate released')}</p>
                                    <p className="m-0 small text-muted">{fmtFechaHora(resumen.liberado_en)}</p>
                                </div>
                            </div>

                            {resumen.quorum !== null && (
                                <p className="text-muted small mb-3">
                                    {getLang() === 'es' ? (
                                        <>
                                            Se necesitaban <strong>{resumen.quorum}</strong> de{' '}
                                            <strong>{resumen.total_custodios}</strong> custodio(s) para confirmar en cada
                                            ronda
                                        </>
                                    ) : (
                                        <>
                                            <strong>{resumen.quorum}</strong> of{' '}
                                            <strong>{resumen.total_custodios}</strong> custodian(s) were needed to confirm in
                                            each round
                                        </>
                                    )}
                                    {resumen.max_reconfirmaciones > 0 && (
                                        <>
                                            {' '}
                                            · {t('reconfirmaciones de vida usadas:', 'life reconfirmations used:')}{' '}
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
                                    <p className="patrimonio-lib-label mb-2">{t('Votos de tus custodios', "Your custodians' votes")}</p>
                                    <div className="d-flex flex-column gap-3 mb-4">
                                        {resumen.rondas.map((r) => (
                                            <div className="patrimonio-lib-ronda" key={r.ronda}>
                                                <p className="m-0 small fw-bold mb-1">{t('Ronda', 'Round')} {r.ronda}</p>
                                                {r.votos.map((v, i) => {
                                                    const s = v.sentido ? sentidoLabel(v.sentido) : null;
                                                    return (
                                                        <div className="patrimonio-lib-voto-row" key={`${r.ronda}-${i}`}>
                                                            <span>{v.custodio_nombre}</span>
                                                            {s ? (
                                                                <span style={{ color: s.color, fontWeight: 700 }}>
                                                                    <i className={`fas ${s.icono} me-1`} />
                                                                    {s.texto} · {fmtFechaHora(v.votado_en)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-muted">{t('Sin respuesta', 'No answer')}</span>
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
                                {t('Si esto es un error y sigues con vida, contacta a soporte para revisar tu caso — iniciar sesión ya no revierte automáticamente un patrimonio liberado.', "If this is a mistake and you're still alive, contact support to review your case — signing in no longer automatically reverts a released estate.")}
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
                                    {t('Entiendo', 'I understand')} <i className="fas fa-arrow-right ms-2" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
