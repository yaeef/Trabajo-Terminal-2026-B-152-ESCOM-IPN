import { useEffect, useRef, useState } from 'react';
import DashboardLayout from '../components/layout/DashboardLayout';
import StorageMeter from '../components/StorageMeter';
import { subscriptionService, type PaypalConfig } from '../services/subscription.service';
import { loadPayPal } from '../services/paypal';
import {
    fechaCorta,
    planAdmiteUso,
    motivosExceso,
    type Plan,
    type PlanActual,
} from '../types/subscription.types';
import { getApiErrorMessage } from '../utils/errors';
import { useAuth } from '../store/AuthContext';
import { useNotice } from '../store/NoticeContext';
import './Suscripcion.css';

// idle -> (confirm | paypal | cancelar) -> processing -> (done | error)
type Phase = 'idle' | 'confirm' | 'paypal' | 'cancelar' | 'processing' | 'done' | 'error';
type Hecho = 'cambio' | 'cancelacion';

const DESC: Record<string, string> = {
    Gratuito: 'Protección básica personal.',
    Premium: 'Para un legado robusto y una red de confianza amplia.',
};

const money = (n: number) => (n === 0 ? '$0' : `$${Math.round(n).toLocaleString('es-MX')}`);
const GB = 1024 ** 3;

export default function Suscripcion() {
    const { refreshUser } = useAuth();
    const { notifyError } = useNotice();

    const [planes, setPlanes] = useState<Plan[]>([]);
    const [actual, setActual] = useState<PlanActual | null>(null);
    const [ppCfg, setPpCfg] = useState<PaypalConfig | null>(null);
    const [loading, setLoading] = useState(true);

    const [phase, setPhase] = useState<Phase>('idle');
    const [target, setTarget] = useState<Plan | null>(null);
    const [bar, setBar] = useState(0);
    const [modalErr, setModalErr] = useState('');
    const [ppRenderErr, setPpRenderErr] = useState('');
    const [hecho, setHecho] = useState<Hecho>('cambio');
    const [reactivando, setReactivando] = useState(false);
    const barTimer = useRef<number | null>(null);
    const ppBox = useRef<HTMLDivElement | null>(null);

    const load = () => {
        setLoading(true);
        Promise.all([
            subscriptionService.listPlanes(),
            subscriptionService.getActual(),
            subscriptionService.getPaypalConfig().catch(() => null),
        ])
            .then(([p, a, cfg]) => {
                setPlanes(p);
                setActual(a);
                setPpCfg(cfg);
            })
            .catch((e) => notifyError(getApiErrorMessage(e, 'No se pudo cargar tu suscripción.')))
            .finally(() => setLoading(false));
    };
    useEffect(load, []);
    useEffect(
        () => () => {
            if (barTimer.current) window.clearInterval(barTimer.current);
        },
        [],
    );

    // Único ciclo de facturación: anual. `costo_anual` es a la vez el precio y el tier.
    const maxCosto = planes.reduce((m, p) => Math.max(m, p.costo_anual), 0);

    const esVigente = (p: Plan) => !!actual && p.id === actual.plan.id;
    // bajada de nivel respecto al plan vigente: no es inmediata, se cancela el
    // plan de pago y sigue vigente hasta que vence
    const esBajada = (p: Plan) => !!actual && p.costo_anual < actual.plan.costo_anual;
    // requiere pasar por caja
    const requierePago = (p: Plan) => p.costo_anual > 0 && !esBajada(p);

    const cancelada = !!actual?.cancelada_en;
    const vence = actual?.fecha_fin ? fechaCorta(actual.fecha_fin) : '';
    const gratuito = planes.find((p) => p.costo_anual === 0) ?? null;

    const iniciarCambio = (p: Plan) => {
        setTarget(p);
        setModalErr('');
        setPpRenderErr('');
        setPhase(requierePago(p) && ppCfg?.configured ? 'paypal' : 'confirm');
    };

    const abrirCancelacion = () => {
        setModalErr('');
        setPhase('cancelar');
    };

    // --- operaciones sin pasarela: cambio directo (gratis / simular pago) o cancelación ---
    const ejecutar = async (op: () => Promise<PlanActual>, tipo: Hecho, fallo: string) => {
        setPhase('processing');
        setBar(0);
        setModalErr('');
        setHecho(tipo);
        barTimer.current = window.setInterval(() => setBar((b) => (b >= 85 ? b : b + 7)), 180);
        try {
            const nuevo = await op();
            if (barTimer.current) window.clearInterval(barTimer.current);
            setBar(100);
            setActual(nuevo);
            await refreshUser();
            setPhase('done');
        } catch (e) {
            if (barTimer.current) window.clearInterval(barTimer.current);
            setModalErr(getApiErrorMessage(e, fallo));
            setPhase('error');
        }
    };

    const cambioDirecto = () => {
        if (!target) return;
        ejecutar(() => subscriptionService.cambiar(target.id), 'cambio', 'No se pudo cambiar el plan.');
    };

    const confirmarCancelacion = () =>
        ejecutar(subscriptionService.cancelar, 'cancelacion', 'No se pudo cancelar tu suscripción.');

    const reactivar = async () => {
        setReactivando(true);
        try {
            setActual(await subscriptionService.reactivar());
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo deshacer la cancelación.'));
        } finally {
            setReactivando(false);
        }
    };

    // --- captura tras la aprobación en PayPal ---
    const trasAprobacion = async (orderID: string) => {
        setPhase('processing');
        setBar(35);
        setHecho('cambio');
        try {
            const nuevo = await subscriptionService.capturar(orderID);
            setBar(100);
            setActual(nuevo);
            await refreshUser();
            setPhase('done');
        } catch (e) {
            setModalErr(getApiErrorMessage(e, 'El pago se aprobó pero no se pudo aplicar el plan.'));
            setPhase('error');
        }
    };

    // Monta los botones de PayPal cuando se abre el modal 'paypal'.
    useEffect(() => {
        if (phase !== 'paypal' || !target || !ppCfg?.configured || !ppCfg.client_id) return;
        let cancelado = false;
        const box = ppBox.current;
        if (box) box.innerHTML = '';

        loadPayPal(ppCfg.client_id, ppCfg.currency)
            .then((paypal) => {
                if (cancelado || !ppBox.current) return;
                return paypal
                    .Buttons({
                        style: { layout: 'vertical', shape: 'pill', label: 'pay' },
                        createOrder: () =>
                            subscriptionService.checkout(target.id).then((r) => r.order_id),
                        onApprove: (data) => trasAprobacion(data.orderID),
                        onCancel: () => cerrarModal(),
                        onError: (err) => {
                            setPpRenderErr(
                                getApiErrorMessage(err, 'PayPal no pudo procesar el pago.'),
                            );
                        },
                    })
                    .render(ppBox.current);
            })
            .catch((e) => {
                if (!cancelado) setPpRenderErr(getApiErrorMessage(e, 'No se pudo cargar PayPal.'));
            });

        return () => {
            cancelado = true;
            if (box) box.innerHTML = '';
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, target?.id, ppCfg]);

    const cerrarModal = () => {
        setPhase('idle');
        setTarget(null);
        setBar(0);
        setPpRenderErr('');
    };

    const precioTxt = (p: Plan) => `${money(p.costo_anual)}${p.costo_anual > 0 ? ' / año' : ' / siempre'}`;

    return (
        <DashboardLayout activeItem="suscripcion" topBarLabel="Planes y Facturación">
            <div className="text-center mb-4">
                <h2 className="fw-bold mb-1">Protege tu legado digital</h2>
                <p className="text-muted m-0">
                    Escala tu seguridad según tus necesidades de resguardo y red de confianza.
                </p>
            </div>

            {loading && <p className="text-muted">Cargando…</p>}

            {!loading && actual && (
                <>
                    {/* Consumo actual */}
                    <div className="config-card mb-4">
                        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                            <h5 className="fw-bold m-0">Tu consumo actual</h5>
                            <span className="plan-actual-chip">
                                <i className="fas fa-circle-check me-1" /> Plan {actual.plan.nombre}
                                {actual.plan.costo_anual > 0 && ' · anual'}
                            </span>
                        </div>
                        {actual.fecha_fin && (
                            <div className={`vigencia-nota mb-3 ${cancelada ? 'is-cancelada' : ''}`}>
                                {cancelada ? (
                                    <>
                                        <span>
                                            <i className="fas fa-calendar-xmark me-2" />
                                            Cancelada: conservas el plan {actual.plan.nombre} hasta que venza el{' '}
                                            <strong>{vence}</strong>; después pasarás a Gratuito.
                                        </span>
                                        <button
                                            className="btn btn-sm btn-outline-ipn rounded-pill"
                                            onClick={reactivar}
                                            disabled={reactivando}
                                        >
                                            {reactivando ? 'Aplicando…' : 'Deshacer cancelación'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span>
                                            <i className="fas fa-calendar-check me-2" />
                                            Vigente · vence el <strong>{vence}</strong>.
                                        </span>
                                        <button className="btn btn-sm btn-link text-muted p-0" onClick={abrirCancelacion}>
                                            Cancelar suscripción
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                        <StorageMeter
                            label="Almacenamiento"
                            usado={actual.uso.almacenamiento_bytes}
                            cuota={actual.plan.max_almacenamiento_gb * GB}
                        />
                        <div className="row g-3 mt-1">
                            <div className="col-sm-6">
                                <div className="uso-mini">
                                    <span className="uso-mini-label">Bóvedas</span>
                                    <span className="uso-mini-val">
                                        {actual.uso.bovedas} <small>/ {actual.plan.max_bovedas}</small>
                                    </span>
                                </div>
                            </div>
                            <div className="col-sm-6">
                                <div className="uso-mini">
                                    <span className="uso-mini-label">Custodios</span>
                                    <span className="uso-mini-val">
                                        {actual.uso.custodios} <small>/ {actual.plan.max_custodios}</small>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Catálogo */}
                    <div className="row g-4 align-items-stretch justify-content-center">
                        {planes.map((p) => {
                            const vigente = esVigente(p);
                            const upgrade = p.costo_anual > actual.plan.costo_anual;
                            const featured = p.costo_anual === maxCosto && maxCosto > 0 && !vigente;
                            const admite = planAdmiteUso(p, actual.uso);
                            const motivos = motivosExceso(p, actual.uso);
                            const porMes = p.costo_anual / 12;

                            return (
                                <div className="col-md-5 col-lg-4" key={p.id}>
                                    <div className={`pricing-card ${featured ? 'featured' : ''} ${vigente ? 'is-current' : ''}`}>
                                        {featured && <div className="plan-badge">Recomendado</div>}
                                        <h5 className="fw-bold mb-1">{p.nombre}</h5>
                                        <p className="text-muted small mb-0">{DESC[p.nombre] ?? 'Plan de resguardo.'}</p>
                                        <div className="price-tag">
                                            {money(p.costo_anual)} <small>/ {p.costo_anual > 0 ? 'año' : 'siempre'}</small>
                                        </div>
                                        {porMes > 0 && <p className="price-sub">≈ {money(porMes)}/mes</p>}

                                        <ul className="feature-list">
                                            <li>
                                                <i className="fas fa-check-circle" /> {p.max_bovedas} Bóveda
                                                {p.max_bovedas === 1 ? '' : 's'} criptográfica{p.max_bovedas === 1 ? '' : 's'}
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" /> {p.max_almacenamiento_gb} GB de almacenamiento
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" /> Hasta {p.max_custodios} custodios
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" />{' '}
                                                {p.costo_anual > 0 ? 'Facturación anual' : 'Sin caducidad'}
                                            </li>
                                        </ul>

                                        {vigente ? (
                                            <button className="btn-plan current-plan-indicator" disabled>
                                                <i className="fas fa-circle-check me-2" /> Tu plan actual
                                            </button>
                                        ) : esBajada(p) ? (
                                            // dejar el plan de pago = cancelarlo; la bajada llega al vencer
                                            <button
                                                className="btn-plan btn-outline-ipn"
                                                onClick={abrirCancelacion}
                                                disabled={cancelada}
                                            >
                                                {cancelada ? `A partir del ${vence}` : 'Cambiar al vencer'}
                                            </button>
                                        ) : upgrade ? (
                                            <button className="btn-plan btn-ipn-solid" onClick={() => iniciarCambio(p)}>
                                                {requierePago(p) && ppCfg?.configured ? (
                                                    <>
                                                        Pagar con PayPal <i className="fab fa-paypal ms-2" />
                                                    </>
                                                ) : (
                                                    'Subir de nivel'
                                                )}
                                            </button>
                                        ) : (
                                            <button
                                                className="btn-plan btn-outline-ipn"
                                                onClick={() => iniciarCambio(p)}
                                                disabled={!admite}
                                                title={admite ? '' : `No disponible: ${motivos.join('; ')}.`}
                                            >
                                                {admite ? 'Cambiar a este plan' : 'Uso actual excede este plan'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-5 p-4 rounded-4 border text-center pago-nota">
                        <p className="m-0 text-muted small">
                            <i className="fab fa-paypal me-2" />
                            {ppCfg?.configured
                                ? `Pagos con PayPal (${ppCfg.mode}). El plan anual se cobra en un solo pago y dura un año; no se renueva solo: al vencer pasas a Gratuito hasta que lo vuelvas a contratar. Si lo cancelas, lo conservas hasta que venza.`
                                : 'PayPal no está configurado en este entorno: los cambios a un plan de pago se simulan.'}
                        </p>
                    </div>
                </>
            )}

            {/* Modal: confirmar (cambio directo / simular) */}
            {phase === 'confirm' && target && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg suscripcion-modal">
                            <div className="modal-header-gradient" />
                            <div className="modal-body p-5 text-center">
                                <div className="mb-3" style={{ color: 'var(--ipn-maroon)' }}>
                                    <i className="fas fa-arrows-rotate fa-3x" />
                                </div>
                                <h4 className="fw-bold mb-1">
                                    Cambiar al plan {target.nombre}
                                    {target.costo_anual > 0 ? ' (anual)' : ''}
                                </h4>
                                <p className="text-muted small mb-4">
                                    {precioTxt(target)} · {target.max_bovedas} bóvedas ·{' '}
                                    {target.max_almacenamiento_gb} GB · {target.max_custodios} custodios.
                                    {requierePago(target) && !ppCfg?.configured && (
                                        <>
                                            <br />
                                            <span className="text-muted">
                                                PayPal no está configurado; el pago se <strong>simulará</strong>.
                                            </span>
                                        </>
                                    )}
                                </p>
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={cerrarModal}>
                                        Cancelar
                                    </button>
                                    <button className="btn btn-ipn w-100 rounded-pill" onClick={cambioDirecto}>
                                        {requierePago(target) && !ppCfg?.configured ? 'Simular pago' : 'Confirmar'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: cancelar (el plan sigue vigente hasta que vence) */}
            {phase === 'cancelar' && actual && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg suscripcion-modal">
                            <div className="modal-header-gradient" />
                            <div className="modal-body p-5 text-center">
                                <div className="mb-3" style={{ color: 'var(--ipn-maroon)' }}>
                                    <i className="fas fa-calendar-xmark fa-3x" />
                                </div>
                                <h4 className="fw-bold mb-1">Cancelar plan {actual.plan.nombre}</h4>
                                <p className="text-muted small mb-4">
                                    No pierdes nada hoy: conservas el plan {actual.plan.nombre} hasta que venza el{' '}
                                    <strong>{vence}</strong> y después pasarás a Gratuito. Puedes deshacerlo antes de
                                    esa fecha.
                                    {gratuito && !planAdmiteUso(gratuito, actual.uso) && (
                                        <>
                                            <br />
                                            <span className="text-warning fw-bold">
                                                Tu uso actual excede el plan Gratuito (
                                                {motivosExceso(gratuito, actual.uso).join('; ')}): al vencer no podrás
                                                crear más ni subir archivos hasta liberar espacio. No se borra nada.
                                            </span>
                                        </>
                                    )}
                                </p>
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={cerrarModal}>
                                        Volver
                                    </button>
                                    <button className="btn btn-ipn w-100 rounded-pill" onClick={confirmarCancelacion}>
                                        Cancelar suscripción
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: pago con PayPal */}
            {phase === 'paypal' && target && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg suscripcion-modal">
                            <div className="modal-header-gradient" />
                            <div className="modal-body p-5 text-center">
                                <div className="mb-3 text-primary">
                                    <i className="fab fa-paypal fa-3x" />
                                </div>
                                <h4 className="fw-bold mb-1">Plan {target.nombre} · anual</h4>
                                <p className="text-muted small mb-4">
                                    {money(target.costo_anual)} {ppCfg?.currency} (pago único anual) · aprueba el pago
                                    con tu cuenta de PayPal {ppCfg?.mode === 'sandbox' ? '(sandbox)' : ''}.
                                </p>

                                {ppRenderErr && <div className="alert alert-danger py-2 small">{ppRenderErr}</div>}

                                <div ref={ppBox} className="pp-buttons" />

                                <button className="btn btn-link text-muted mt-2" onClick={cerrarModal}>
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: procesando / resultado */}
            {(phase === 'processing' || phase === 'done' || phase === 'error') && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg suscripcion-modal">
                            <div
                                className="modal-header-gradient"
                                style={
                                    phase === 'done'
                                        ? { background: 'var(--escom-blue)' }
                                        : phase === 'error'
                                          ? { background: 'var(--danger-red, #ef4444)' }
                                          : undefined
                                }
                            />
                            <div className="modal-body p-5 text-center">
                                {phase === 'processing' && (
                                    <>
                                        <div className="mb-4">
                                            <i className="fas fa-circle-notch fa-spin fa-3x text-primary" />
                                        </div>
                                        <h4 className="fw-bold">Procesando</h4>
                                        <p className="text-muted small">
                                            {hecho === 'cancelacion' ? (
                                                'Cancelando tu suscripción…'
                                            ) : (
                                                <>
                                                    Aplicando el plan <strong>{target?.nombre}</strong>…
                                                </>
                                            )}
                                        </p>
                                        <div className="susc-progress mt-4">
                                            <div className="susc-progress-bar" style={{ width: `${bar}%` }} />
                                        </div>
                                    </>
                                )}

                                {phase === 'done' && (
                                    <>
                                        <div className="mb-3">
                                            <i className="fas fa-check-circle fa-3x animate__animated animate__bounceIn" style={{ color: 'var(--escom-blue)' }} />
                                        </div>
                                        <h4 className="fw-bold">
                                            {hecho === 'cancelacion' ? 'Suscripción cancelada' : 'Plan actualizado'}
                                        </h4>
                                        <p className="text-muted small">
                                            {hecho === 'cancelacion' ? (
                                                <>
                                                    Conservas el plan <strong>{actual?.plan.nombre}</strong> hasta que
                                                    venza el {vence}; después pasarás a Gratuito.
                                                </>
                                            ) : (
                                                <>
                                                    Ahora estás en el plan <strong>{actual?.plan.nombre}</strong>
                                                    {vence && ` (anual, vence el ${vence})`}.
                                                </>
                                            )}
                                        </p>
                                        <button className="btn btn-ipn rounded-pill px-5 mt-2" onClick={cerrarModal}>
                                            Listo
                                        </button>
                                    </>
                                )}

                                {phase === 'error' && (
                                    <>
                                        <div className="mb-3 text-danger">
                                            <i className="fas fa-triangle-exclamation fa-3x" />
                                        </div>
                                        <h4 className="fw-bold">No se pudo completar</h4>
                                        <p className="text-muted small">{modalErr}</p>
                                        <button className="btn btn-light w-100 rounded-pill mt-2" onClick={cerrarModal}>
                                            Cerrar
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
