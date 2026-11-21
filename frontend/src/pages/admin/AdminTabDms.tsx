import { useEffect, useState } from 'react';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import type { DmsEstado } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import AdminMotivoModal from './AdminMotivoModal';
import { locale, t } from '../../i18n';

interface Props {
    idPropietario: number;
}

const EN_CURSO = new Set(['alerta', 'gracia', 'gracia_reduccion']);
const CON_VOTACION = new Set(['gracia', 'gracia_reduccion']);

const sentidoLabel = (s: string): string =>
    s === 'vida' ? t('Vida', 'Alive') : s === 'fallecimiento' ? t('Fallecimiento', 'Death') : s;

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale()) : '—');

export default function AdminTabDms({ idPropietario }: Props) {
    const [estado, setEstado] = useState<DmsEstado | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const { notifyError, notifySuccess } = useNotice();

    const [showAviso, setShowAviso] = useState(false);
    const [showBarrido, setShowBarrido] = useState(false);
    const [showExtender, setShowExtender] = useState(false);
    const [dias, setDias] = useState(5);
    const [motivoExtender, setMotivoExtender] = useState('');
    const [extendiendo, setExtendiendo] = useState(false);
    const [extenderErr, setExtenderErr] = useState('');

    const cargar = () => {
        setLoading(true);
        setLoadFailed(false);
        adminService
            .estadoDms(idPropietario)
            .then(setEstado)
            .catch((e) => {
                setLoadFailed(true);
                notifyError(getApiErrorMessage(e, t('No se pudo cargar el estado del DMS.', "Couldn't load the DMS status.")));
            })
            .finally(() => setLoading(false));
    };
    useEffect(cargar, [idPropietario]);

    const reenviarAviso = async (motivo: string) => {
        try {
            await adminService.reenviarAvisoDms(idPropietario, { motivo });
            setShowAviso(false);
            notifySuccess(t('Se reenvió el aviso del estado vigente.', 'The current-status notice was resent.'));
            cargar();
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo reenviar el aviso.', "Couldn't resend the notice.")));
            throw e;
        }
    };

    const forzarBarrido = async (motivo: string) => {
        try {
            const r = await adminService.forzarBarridoDms(idPropietario, { motivo });
            setShowBarrido(false);
            notifySuccess(
                r.transicion
                    ? t(`Se aplicó la transición: ${r.transicion}.`, `Transition applied: ${r.transicion}.`)
                    : t('Se evaluó el barrido; no hubo transición pendiente.', 'The sweep was evaluated; there was no pending transition.'),
            );
            cargar();
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo forzar el barrido.', "Couldn't force the sweep.")));
            throw e;
        }
    };

    const extenderPlazo = async () => {
        if (motivoExtender.trim().length < 5) {
            setExtenderErr(t('Escribe un motivo de al menos 5 caracteres.', 'Write a reason of at least 5 characters.'));
            return;
        }
        setExtendiendo(true);
        setExtenderErr('');
        try {
            await adminService.extenderPlazoDms(idPropietario, { dias, motivo: motivoExtender.trim() });
            setShowExtender(false);
            setMotivoExtender('');
            notifySuccess(t(`Se extendió el plazo ${dias} día(s).`, `The deadline was extended by ${dias} day(s).`));
            cargar();
        } catch (e) {
            setExtenderErr(getApiErrorMessage(e, t('No se pudo extender el plazo.', "Couldn't extend the deadline.")));
        } finally {
            setExtendiendo(false);
        }
    };

    if (loading) return <p className="text-muted">{t('Cargando…', 'Loading…')}</p>;
    if (loadFailed) return null;
    if (!estado) return null;

    const enCurso = EN_CURSO.has(estado.status_dms);
    const conVotacion = CON_VOTACION.has(estado.status_dms);
    const resumen = estado.resumen_liberacion;

    return (
        <div>
            <div className="row g-4 mb-4">
                <div className="col-md-3">
                    <div className="stat-card h-100">
                        <p className="verif-label mb-2">{t('Ronda', 'Round')}</p>
                        <h3 className="fw-bold m-0">{estado.dms_ronda}</h3>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="stat-card h-100">
                        <p className="verif-label mb-2">{t('Quórum', 'Quorum')}</p>
                        <h3 className="fw-bold m-0">{estado.dms_quorum ?? '—'}</h3>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="stat-card h-100">
                        <p className="verif-label mb-2">{t('Reconfirmaciones', 'Reconfirmations')}</p>
                        <h3 className="fw-bold m-0">
                            {estado.dms_reconfirmaciones} / {resumen.max_reconfirmaciones}
                        </h3>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="stat-card h-100">
                        <p className="verif-label mb-2">{t('Votos vigentes', 'Current votes')}</p>
                        <h3 className="fw-bold m-0">
                            <span className="text-success">{estado.votos.vida} {t('vida', 'alive')}</span> ·{' '}
                            <span className="text-danger">{estado.votos.fallecimiento} {t('fallec.', 'death')}</span>
                        </h3>
                    </div>
                </div>
            </div>

            <div className="admin-card p-4 mb-4">
                <h5 className="fw-bold mb-3">{t('Plazos', 'Deadlines')}</h5>
                <div className="row g-3 small">
                    <div className="col-md-3"><span className="text-muted d-block">{t('Entró a alerta', 'Went on alert')}</span>{fecha(estado.dms_alerta_en)}</div>
                    <div className="col-md-3"><span className="text-muted d-block">{t('Entró a gracia', 'Entered grace')}</span>{fecha(estado.dms_gracia_en)}</div>
                    <div className="col-md-3"><span className="text-muted d-block">{t('Vence reducción', 'Reduction ends')}</span>{fecha(estado.dms_reduccion_hasta)}</div>
                    <div className="col-md-3"><span className="text-muted d-block">{t('Último aviso', 'Last notice')}</span>{fecha(estado.dms_ultimo_aviso)}</div>
                </div>

                <hr />
                <div className="d-flex gap-2 flex-wrap">
                    <button className="btn btn-ipn btn-sm" onClick={() => setShowAviso(true)} disabled={!enCurso}>
                        <i className="fas fa-bell me-2" /> {t('Reenviar aviso', 'Resend notice')}
                    </button>
                    <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setShowExtender(true)} disabled={!conVotacion}>
                        <i className="fas fa-clock me-2" /> {t('Extender plazo', 'Extend deadline')}
                    </button>
                    <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setShowBarrido(true)}>
                        <i className="fas fa-rotate me-2" /> {t('Forzar barrido ahora', 'Force sweep now')}
                    </button>
                </div>
                {!enCurso && (
                    <p className="small text-muted mt-2 mb-0">
                        {t('"Reenviar aviso" y "Extender plazo" solo aplican con un episodio del DMS en curso.', '"Resend notice" and "Extend deadline" only apply while a DMS episode is in progress.')}
                    </p>
                )}
            </div>

            {resumen.liberado && (
                <div className="admin-card p-4">
                    <h5 className="fw-bold mb-2">{t('Por qué se liberó', 'Why it was released')}</h5>
                    <p className="small mb-3">{resumen.motivo_detalle}</p>
                    <p className="small text-muted mb-3">
                        {t(
                            `Liberado el ${fecha(resumen.liberado_en)} · quórum ${resumen.quorum} de ${resumen.total_custodios} custodios.`,
                            `Released on ${fecha(resumen.liberado_en)} · quorum ${resumen.quorum} of ${resumen.total_custodios} custodians.`,
                        )}
                    </p>
                    {resumen.rondas.map((r) => (
                        <div key={r.ronda} className="mb-3">
                            <p className="small fw-bold mb-1">{t('Ronda', 'Round')} {r.ronda}</p>
                            {r.votos.map((v, i) => (
                                <div key={i} className="d-flex justify-content-between small border-bottom py-1">
                                    <span>{v.custodio_nombre}</span>
                                    <span className={v.sentido === 'fallecimiento' ? 'text-danger' : v.sentido === 'vida' ? 'text-success' : 'text-muted'}>
                                        {v.sentido ? sentidoLabel(v.sentido) : t('Sin voto', 'No vote')}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}

            {showAviso && (
                <AdminMotivoModal
                    title={t('Reenviar aviso del estado vigente', 'Resend the current-status notice')}
                    description={t('Reenvía ya mismo el correo/Telegram correspondiente, sin esperar la cadencia normal.', 'Resends the matching email/Telegram right away, without waiting for the normal cadence.')}
                    confirmLabel={t('Reenviar aviso', 'Resend notice')}
                    onConfirm={reenviarAviso}
                    onClose={() => setShowAviso(false)}
                />
            )}
            {showBarrido && (
                <AdminMotivoModal
                    title={t('Forzar el barrido del DMS ahora', 'Force the DMS sweep now')}
                    description={t('Evalúa de inmediato si corresponde una transición de estado para este propietario, sin esperar al barrido horario.', 'Immediately evaluates whether a status transition applies to this owner, without waiting for the hourly sweep.')}
                    confirmLabel={t('Forzar barrido', 'Force sweep')}
                    onConfirm={forzarBarrido}
                    onClose={() => setShowBarrido(false)}
                />
            )}
            {showExtender && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" />
                            <div className="modal-body p-5">
                                <h4 className="fw-bold mb-1">{t('Extender plazo', 'Extend deadline')}</h4>
                                <p className="text-muted small mb-4">
                                    {t('Suma días al plazo vigente de gracia/gracia-reducción (p. ej. un custodio con impedimento justificado).', 'Adds days to the current grace/grace-reduction deadline (e.g. a custodian with a justified impediment).')}
                                </p>
                                {extenderErr && <div className="alert alert-danger py-2 small">{extenderErr}</div>}
                                <label className="form-label-b d-block">{t('Días a extender (1-90)', 'Days to extend (1-90)')}</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={90}
                                    className="form-control shadow-none mb-3"
                                    value={dias}
                                    onChange={(e) => setDias(Number(e.target.value))}
                                />
                                <label className="form-label-b d-block">{t('Motivo (queda en la auditoría)', 'Reason (recorded in the audit log)')}</label>
                                <textarea
                                    className="form-control shadow-none mb-4"
                                    rows={2}
                                    value={motivoExtender}
                                    onChange={(e) => setMotivoExtender(e.target.value)}
                                    placeholder={t('Ej: custodio hospitalizado, no puede votar esta semana.', "e.g. custodian hospitalized, can't vote this week.")}
                                />
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={() => setShowExtender(false)} disabled={extendiendo}>
                                        {t('Cancelar', 'Cancel')}
                                    </button>
                                    <button className="btn btn-ipn w-100" onClick={extenderPlazo} disabled={extendiendo}>
                                        {extendiendo ? t('Extendiendo…', 'Extending…') : t('Extender', 'Extend')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
