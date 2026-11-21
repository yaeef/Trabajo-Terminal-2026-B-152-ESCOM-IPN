import { useEffect, useState } from 'react';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import {
    fechaCorta,
    motivosExceso,
    nombrePlan,
    planAdmiteUso,
    tamanoPlan,
    type Plan,
    type PlanActual,
} from '../../types/subscription.types';
import { getApiErrorMessage } from '../../utils/errors';
import { locale, t } from '../../i18n';

interface Props {
    idPropietario: number;
    onCambio: () => void;
}

const money = (n: number) => (n === 0 ? '$0' : `$${Math.round(n).toLocaleString(locale())}`);

const cobertura = (c: PlanActual['cobertura']): string =>
    ({
        gratuito: t('Sin costo', 'Free of charge'),
        pago: t('Año pagado', 'Paid year'),
        gracia: t('En gracia tras vencer', 'In grace after expiring'),
        reserva: t('Cubierto por el año de reserva', 'Covered by the reserve year'),
    })[c];

export default function AdminTabSuscripcion({ idPropietario, onCambio }: Props) {
    const [actual, setActual] = useState<PlanActual | null>(null);
    const [planes, setPlanes] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const { notifyError, notifySuccess } = useNotice();

    const [showCambiar, setShowCambiar] = useState(false);
    const [destino, setDestino] = useState<Plan | null>(null);
    const [motivo, setMotivo] = useState('');
    const [cambiando, setCambiando] = useState(false);
    const [cambiarErr, setCambiarErr] = useState('');

    const cargar = () => {
        setLoading(true);
        setLoadFailed(false);
        Promise.all([adminService.estadoSuscripcion(idPropietario), adminService.listarPlanes()])
            .then(([a, p]) => {
                setActual(a);
                setPlanes(p);
            })
            .catch((e) => {
                setLoadFailed(true);
                notifyError(getApiErrorMessage(e, t('No se pudo cargar la suscripción.', "Couldn't load the subscription.")));
            })
            .finally(() => setLoading(false));
    };
    useEffect(cargar, [idPropietario]);

    const abrirCambio = () => {
        setDestino(null);
        setMotivo('');
        setCambiarErr('');
        setShowCambiar(true);
    };

    const confirmarCambio = async () => {
        if (!destino) {
            setCambiarErr(t('Elige un plan destino.', 'Choose a target plan.'));
            return;
        }
        if (motivo.trim().length < 5) {
            setCambiarErr(t('Escribe un motivo de al menos 5 caracteres.', 'Write a reason of at least 5 characters.'));
            return;
        }
        setCambiando(true);
        setCambiarErr('');
        try {
            await adminService.cambiarPlan(idPropietario, { id_plan: destino.id, motivo: motivo.trim() });
            setShowCambiar(false);
            notifySuccess(t(`Se cambió el plan a ${nombrePlan(destino.nombre)}.`, `The plan was changed to ${nombrePlan(destino.nombre)}.`));
            cargar();
            onCambio();
        } catch (e) {
            setCambiarErr(getApiErrorMessage(e, t('No se pudo cambiar el plan.', "Couldn't change the plan.")));
        } finally {
            setCambiando(false);
        }
    };

    if (loading) return <p className="text-muted">{t('Cargando…', 'Loading…')}</p>;
    if (loadFailed) return null;
    if (!actual) return null;

    return (
        <div>
            <div className="admin-card p-4 mb-4">
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
                    <div>
                        <h5 className="fw-bold mb-1">Plan {nombrePlan(actual.plan.nombre)}</h5>
                        <p className="text-muted small mb-0">
                            {cobertura(actual.cobertura)} · {t('desde', 'since')} {fechaCorta(actual.fecha_inicio)}
                            {actual.fecha_fin && <> · {t('hasta', 'until')} {fechaCorta(actual.fecha_fin)}</>}
                            {actual.pagado_hasta && actual.pagado_hasta !== actual.fecha_fin && (
                                <> · {t('renovado hasta', 'renewed until')} {fechaCorta(actual.pagado_hasta)}</>
                            )}
                            {actual.cancelada_en && <> · {t('sin avisos de renovación', 'no renewal reminders')}</>}
                            {actual.reserva && (
                                <>
                                    {' '}
                                    · {t('año de reserva', 'reserve year')}{' '}
                                    {actual.reserva.estado === 'activa' ? t('en uso', 'in use') : t('guardado', 'saved')}
                                </>
                            )}
                        </p>
                        {actual.impago && (
                            <p className="small mb-0 mt-1 text-danger fw-bold">
                                {actual.impago.estado === 'pausado'
                                    ? t('Recorte por impago en pausa (DMS no activo)', 'Non-payment trim paused (DMS not active)')
                                    : t(
                                          `Recorte por impago el ${fechaCorta(actual.impago.recorte_en)}`,
                                          `Non-payment trim on ${fechaCorta(actual.impago.recorte_en)}`,
                                      )}
                                {actual.impago.excesos.length > 0 && `: ${actual.impago.excesos.join('; ')}`}
                            </p>
                        )}
                    </div>
                    <button className="btn btn-ipn btn-sm" onClick={abrirCambio}>
                        <i className="fas fa-arrows-rotate me-2" /> {t('Cambiar plan', 'Change plan')}
                    </button>
                </div>
                <hr />
                <div className="row g-3 small">
                    <div className="col-md-4">
                        <span className="text-muted d-block">{t('Bóvedas', 'Vaults')}</span>
                        {actual.uso.bovedas} / {actual.plan.max_bovedas}
                    </div>
                    <div className="col-md-4">
                        <span className="text-muted d-block">{t('Custodios', 'Custodians')}</span>
                        {actual.uso.custodios} / {actual.plan.max_custodios} ({t('+1 de reemplazo', '+1 replacement')})
                    </div>
                    <div className="col-md-4">
                        <span className="text-muted d-block">{t('Almacenamiento', 'Storage')}</span>
                        {(actual.uso.almacenamiento_bytes / 1024 ** 3).toFixed(2)} GB / {tamanoPlan(actual.plan.max_almacenamiento_mb)}
                    </div>
                </div>
            </div>

            {showCambiar && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered modal-lg">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" />
                            <div className="modal-body p-5">
                                <h4 className="fw-bold mb-1">{t('Cambiar plan', 'Change plan')}</h4>
                                <p className="text-muted small mb-4">
                                    {t('Cambio manual de soporte, sin pasarela de pago: surte efecto de inmediato. Un plan de pago asignado aquí dura un año desde hoy.', 'Manual support change, without a payment gateway: it takes effect immediately. A paid plan assigned here lasts one year from today.')}
                                </p>
                                {cambiarErr && <div className="alert alert-danger py-2 small">{cambiarErr}</div>}

                                <div className="row g-3 mb-4">
                                    {planes.map((p) => {
                                        const admite = planAdmiteUso(p, actual.uso);
                                        const motivos = admite ? [] : motivosExceso(p, actual.uso);
                                        const seleccionado = destino?.id === p.id;
                                        return (
                                            <div className="col-md-6" key={p.id}>
                                                <button
                                                    type="button"
                                                    className="w-100 h-100 text-start border rounded-4 p-3"
                                                    style={{
                                                        borderColor: seleccionado ? 'var(--escom-blue)' : undefined,
                                                        borderWidth: seleccionado ? 2 : 1,
                                                        opacity: admite ? 1 : 0.6,
                                                        background: 'transparent',
                                                    }}
                                                    onClick={() => admite && setDestino(p)}
                                                    disabled={!admite}
                                                >
                                                    <div className="d-flex justify-content-between">
                                                        <strong>{nombrePlan(p.nombre)}</strong>
                                                        <span>
                                                            {money(p.costo_anual)}
                                                            {p.costo_anual > 0 && <small className="text-muted"> / {t('año', 'year')}</small>}
                                                        </span>
                                                    </div>
                                                    <p className="small text-muted mb-0">
                                                        {p.max_bovedas} {t('bóvedas', 'vaults')} · {p.max_custodios} {t('custodios', 'custodians')} ·{' '}
                                                        {tamanoPlan(p.max_almacenamiento_mb)}
                                                    </p>
                                                    {!admite && (
                                                        <p className="small mb-0" style={{ color: 'var(--danger-red)' }}>
                                                            {t('No cabe', "Doesn't fit")}: {motivos.join('; ')}.
                                                        </p>
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>

                                <label className="form-label-b d-block">{t('Motivo (queda en la auditoría)', 'Reason (recorded in the audit log)')}</label>
                                <textarea
                                    className="form-control shadow-none mb-4"
                                    rows={2}
                                    value={motivo}
                                    onChange={(e) => setMotivo(e.target.value)}
                                    placeholder={t('Ej: cortesía de soporte por incidencia de pago.', 'e.g. support courtesy due to a payment issue.')}
                                />

                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={() => setShowCambiar(false)} disabled={cambiando}>
                                        {t('Cancelar', 'Cancel')}
                                    </button>
                                    <button className="btn btn-ipn w-100" onClick={confirmarCambio} disabled={cambiando || !destino}>
                                        {cambiando ? t('Aplicando…', 'Applying…') : t('Aplicar cambio', 'Apply change')}
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
