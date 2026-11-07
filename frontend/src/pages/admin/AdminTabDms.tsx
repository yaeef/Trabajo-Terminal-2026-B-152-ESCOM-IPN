import { useEffect, useState } from 'react';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import type { DmsEstado } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import AdminMotivoModal from './AdminMotivoModal';

interface Props {
    idPropietario: number;
}

const EN_CURSO = new Set(['alerta', 'gracia', 'gracia_reduccion']);
const CON_VOTACION = new Set(['gracia', 'gracia_reduccion']);

const SENTIDO_LABEL: Record<string, string> = { vida: 'Vida', fallecimiento: 'Fallecimiento' };

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-MX') : '—');

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
                notifyError(getApiErrorMessage(e, 'No se pudo cargar el estado del DMS.'));
            })
            .finally(() => setLoading(false));
    };
    useEffect(cargar, [idPropietario]);

    const reenviarAviso = async (motivo: string) => {
        try {
            await adminService.reenviarAvisoDms(idPropietario, { motivo });
            setShowAviso(false);
            notifySuccess('Se reenvió el aviso del estado vigente.');
            cargar();
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo reenviar el aviso.'));
            throw e;
        }
    };

    const forzarBarrido = async (motivo: string) => {
        try {
            const r = await adminService.forzarBarridoDms(idPropietario, { motivo });
            setShowBarrido(false);
            notifySuccess(r.transicion ? `Se aplicó la transición: ${r.transicion}.` : 'Se evaluó el barrido; no hubo transición pendiente.');
            cargar();
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo forzar el barrido.'));
            throw e;
        }
    };

    const extenderPlazo = async () => {
        if (motivoExtender.trim().length < 5) {
            setExtenderErr('Escribe un motivo de al menos 5 caracteres.');
            return;
        }
        setExtendiendo(true);
        setExtenderErr('');
        try {
            await adminService.extenderPlazoDms(idPropietario, { dias, motivo: motivoExtender.trim() });
            setShowExtender(false);
            setMotivoExtender('');
            notifySuccess(`Se extendió el plazo ${dias} día(s).`);
            cargar();
        } catch (e) {
            setExtenderErr(getApiErrorMessage(e, 'No se pudo extender el plazo.'));
        } finally {
            setExtendiendo(false);
        }
    };

    if (loading) return <p className="text-muted">Cargando…</p>;
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
                        <p className="verif-label mb-2">Ronda</p>
                        <h3 className="fw-bold m-0">{estado.dms_ronda}</h3>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="stat-card h-100">
                        <p className="verif-label mb-2">Quórum</p>
                        <h3 className="fw-bold m-0">{estado.dms_quorum ?? '—'}</h3>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="stat-card h-100">
                        <p className="verif-label mb-2">Reconfirmaciones</p>
                        <h3 className="fw-bold m-0">
                            {estado.dms_reconfirmaciones} / {resumen.max_reconfirmaciones}
                        </h3>
                    </div>
                </div>
                <div className="col-md-3">
                    <div className="stat-card h-100">
                        <p className="verif-label mb-2">Votos vigentes</p>
                        <h3 className="fw-bold m-0">
                            <span className="text-success">{estado.votos.vida} vida</span> ·{' '}
                            <span className="text-danger">{estado.votos.fallecimiento} fallec.</span>
                        </h3>
                    </div>
                </div>
            </div>

            <div className="admin-card p-4 mb-4">
                <h5 className="fw-bold mb-3">Plazos</h5>
                <div className="row g-3 small">
                    <div className="col-md-3"><span className="text-muted d-block">Entró a alerta</span>{fecha(estado.dms_alerta_en)}</div>
                    <div className="col-md-3"><span className="text-muted d-block">Entró a gracia</span>{fecha(estado.dms_gracia_en)}</div>
                    <div className="col-md-3"><span className="text-muted d-block">Vence reducción</span>{fecha(estado.dms_reduccion_hasta)}</div>
                    <div className="col-md-3"><span className="text-muted d-block">Último aviso</span>{fecha(estado.dms_ultimo_aviso)}</div>
                </div>

                <hr />
                <div className="d-flex gap-2 flex-wrap">
                    <button className="btn btn-ipn btn-sm" onClick={() => setShowAviso(true)} disabled={!enCurso}>
                        <i className="fas fa-bell me-2" /> Reenviar aviso
                    </button>
                    <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setShowExtender(true)} disabled={!conVotacion}>
                        <i className="fas fa-clock me-2" /> Extender plazo
                    </button>
                    <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setShowBarrido(true)}>
                        <i className="fas fa-rotate me-2" /> Forzar barrido ahora
                    </button>
                </div>
                {!enCurso && (
                    <p className="small text-muted mt-2 mb-0">
                        "Reenviar aviso" y "Extender plazo" solo aplican con un episodio del DMS en curso.
                    </p>
                )}
            </div>

            {resumen.liberado && (
                <div className="admin-card p-4">
                    <h5 className="fw-bold mb-2">Por qué se liberó</h5>
                    <p className="small mb-3">{resumen.motivo_detalle}</p>
                    <p className="small text-muted mb-3">
                        Liberado el {fecha(resumen.liberado_en)} · quórum {resumen.quorum} de {resumen.total_custodios} custodios.
                    </p>
                    {resumen.rondas.map((r) => (
                        <div key={r.ronda} className="mb-3">
                            <p className="small fw-bold mb-1">Ronda {r.ronda}</p>
                            {r.votos.map((v, i) => (
                                <div key={i} className="d-flex justify-content-between small border-bottom py-1">
                                    <span>{v.custodio_nombre}</span>
                                    <span className={v.sentido === 'fallecimiento' ? 'text-danger' : v.sentido === 'vida' ? 'text-success' : 'text-muted'}>
                                        {v.sentido ? SENTIDO_LABEL[v.sentido] : 'Sin voto'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}

            {showAviso && (
                <AdminMotivoModal
                    title="Reenviar aviso del estado vigente"
                    description="Reenvía ya mismo el correo/Telegram correspondiente, sin esperar la cadencia normal."
                    confirmLabel="Reenviar aviso"
                    onConfirm={reenviarAviso}
                    onClose={() => setShowAviso(false)}
                />
            )}
            {showBarrido && (
                <AdminMotivoModal
                    title="Forzar el barrido del DMS ahora"
                    description="Evalúa de inmediato si corresponde una transición de estado para este propietario, sin esperar al barrido horario."
                    confirmLabel="Forzar barrido"
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
                                <h4 className="fw-bold mb-1">Extender plazo</h4>
                                <p className="text-muted small mb-4">
                                    Suma días al plazo vigente de gracia/gracia-reducción (p. ej. un custodio con
                                    impedimento justificado).
                                </p>
                                {extenderErr && <div className="alert alert-danger py-2 small">{extenderErr}</div>}
                                <label className="form-label-b d-block">Días a extender (1-90)</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={90}
                                    className="form-control shadow-none mb-3"
                                    value={dias}
                                    onChange={(e) => setDias(Number(e.target.value))}
                                />
                                <label className="form-label-b d-block">Motivo (queda en la auditoría)</label>
                                <textarea
                                    className="form-control shadow-none mb-4"
                                    rows={2}
                                    value={motivoExtender}
                                    onChange={(e) => setMotivoExtender(e.target.value)}
                                    placeholder="Ej: custodio hospitalizado, no puede votar esta semana."
                                />
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={() => setShowExtender(false)} disabled={extendiendo}>
                                        Cancelar
                                    </button>
                                    <button className="btn btn-ipn w-100" onClick={extenderPlazo} disabled={extendiendo}>
                                        {extendiendo ? 'Extendiendo…' : 'Extender'}
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
