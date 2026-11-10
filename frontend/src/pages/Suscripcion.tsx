import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import StorageMeter from '../components/StorageMeter';
import { subscriptionService, type PaypalConfig } from '../services/subscription.service';
import { loadPayPal } from '../services/paypal';
import { fechaCorta, type Compra, type Plan, type PlanActual } from '../types/subscription.types';
import { getApiErrorMessage } from '../utils/errors';
import { useAuth } from '../store/AuthContext';
import { useNotice } from '../store/NoticeContext';
import './Suscripcion.css';

// idle -> (compra | cancelar) -> processing -> (done | error)
type Phase = 'idle' | 'compra' | 'cancelar' | 'processing' | 'done' | 'error';
type Hecho = 'compra' | 'avisos';

interface CompraEnCurso {
    plan: Plan;
    incluyePlan: boolean;
    incluyeReserva: boolean;
}

const DESC: Record<string, string> = {
    Gratuito: 'Protección básica personal.',
    Premium: 'Para un legado robusto y una red de confianza amplia.',
};

const money = (n: number) => (n === 0 ? '$0' : `$${Math.round(n).toLocaleString('es-MX')}`);
const GB = 1024 ** 3;

const aCompra = (c: CompraEnCurso): Compra => ({
    plan_id: c.plan.id,
    incluye_plan: c.incluyePlan,
    incluye_reserva: c.incluyeReserva,
});

export default function Suscripcion() {
    const { refreshUser } = useAuth();
    const { notifyError } = useNotice();
    const navigate = useNavigate();

    const [planes, setPlanes] = useState<Plan[]>([]);
    const [actual, setActual] = useState<PlanActual | null>(null);
    const [ppCfg, setPpCfg] = useState<PaypalConfig | null>(null);
    const [loading, setLoading] = useState(true);

    const [phase, setPhase] = useState<Phase>('idle');
    const [compra, setCompra] = useState<CompraEnCurso | null>(null);
    const [bar, setBar] = useState(0);
    const [modalErr, setModalErr] = useState('');
    const [ppRenderErr, setPpRenderErr] = useState('');
    const [hecho, setHecho] = useState<Hecho>('compra');
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

    const maxCosto = planes.reduce((m, p) => Math.max(m, p.costo_anual), 0);
    const cobertura = actual?.cobertura ?? 'gratuito';
    // Plan que cubre hoy si es de pago (en pago, gracia o reserva solo se renueva ese).
    const planCubierto = actual && actual.plan.costo_anual > 0 ? actual.plan : null;
    const planDePago = planCubierto ?? planes.find((p) => p.costo_reserva > 0) ?? null;
    const cancelada = !!actual?.cancelada_en;
    const f = (iso: string | null | undefined) => (iso ? fechaCorta(iso) : '');

    // ¿Puede sumar el año de reserva a una compra del plan? (una sin consumir
    // a la vez; la que cubre hoy se gasta al pagar, así que no estorba)
    const reservaSumable = (p: Plan) =>
        p.costo_reserva > 0 && (!actual?.reserva || cobertura === 'reserva');

    const abrirCompra = (plan: Plan, incluyePlan: boolean, incluyeReserva: boolean) => {
        setCompra({ plan, incluyePlan, incluyeReserva });
        setModalErr('');
        setPpRenderErr('');
        setPhase('compra');
    };

    const abrirCancelacion = () => {
        setModalErr('');
        setPhase('cancelar');
    };

    // --- operaciones sin pasarela: compra simulada o dejar de recibir avisos ---
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

    const simularCompra = () => {
        if (!compra) return;
        ejecutar(() => subscriptionService.comprarSimulado(aCompra(compra)), 'compra', 'No se pudo completar la compra.');
    };

    const confirmarCancelacion = () =>
        ejecutar(subscriptionService.cancelar, 'avisos', 'No se pudo guardar tu preferencia.');

    const reactivar = async () => {
        setReactivando(true);
        try {
            setActual(await subscriptionService.reactivar());
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo guardar tu preferencia.'));
        } finally {
            setReactivando(false);
        }
    };

    // --- captura tras la aprobación en PayPal ---
    const trasAprobacion = async (orderID: string) => {
        setPhase('processing');
        setBar(35);
        setHecho('compra');
        try {
            const nuevo = await subscriptionService.capturar(orderID);
            setBar(100);
            setActual(nuevo);
            await refreshUser();
            setPhase('done');
        } catch (e) {
            setModalErr(getApiErrorMessage(e, 'El pago se aprobó pero no se pudo aplicar la compra.'));
            setPhase('error');
        }
    };

    // Monta los botones de PayPal en el modal de compra (y los rehace si cambia lo que se compra).
    useEffect(() => {
        if (phase !== 'compra' || !compra || !ppCfg?.configured || !ppCfg.client_id) return;
        let cancelado = false;
        const box = ppBox.current;
        if (box) box.innerHTML = '';
        const pedido = aCompra(compra);

        loadPayPal(ppCfg.client_id, ppCfg.currency)
            .then((paypal) => {
                if (cancelado || !ppBox.current) return;
                return paypal
                    .Buttons({
                        style: { layout: 'vertical', shape: 'pill', label: 'pay' },
                        createOrder: () => subscriptionService.checkout(pedido).then((r) => r.order_id),
                        onApprove: (data) => trasAprobacion(data.orderID),
                        onCancel: () => cerrarModal(),
                        onError: (err) => {
                            setPpRenderErr(getApiErrorMessage(err, 'PayPal no pudo procesar el pago.'));
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
    }, [phase, compra?.plan.id, compra?.incluyePlan, compra?.incluyeReserva, ppCfg]);

    const cerrarModal = () => {
        setPhase('idle');
        setCompra(null);
        setBar(0);
        setPpRenderErr('');
    };

    /** Botón del plan de pago en el catálogo, según la cobertura de hoy. */
    const accionPlan = (p: Plan) => {
        if (!actual) return null;
        const solido = (label: string, onClick: () => void) => (
            <button className="btn-plan btn-ipn-solid" onClick={onClick}>
                {label}
                {ppCfg?.configured && <i className="fab fa-paypal ms-2" />}
            </button>
        );
        const inactivo = (label: string) => (
            <button className="btn-plan current-plan-indicator" disabled>
                {label}
            </button>
        );
        const comprar = () => abrirCompra(p, true, false);

        if (cobertura === 'gratuito') return solido('Contratar', comprar);
        if (planCubierto && p.id !== planCubierto.id) return inactivo('No disponible con tu plan actual');
        if (cobertura === 'gracia' || cobertura === 'reserva') return solido('Renovar ahora', comprar);
        if (actual.puede_renovar) return solido('Renovar un año más', comprar);
        if (actual.renovable_desde) return inactivo(`Renovable desde el ${f(actual.renovable_desde)}`);
        return inactivo(`Renovado hasta el ${f(actual.pagado_hasta)}`);
    };

    /** Explicación de desde cuándo cuenta el año que se compra. */
    const notaInicio = () => {
        if (!actual || !compra?.incluyePlan) return null;
        switch (cobertura) {
            case 'pago':
                return `El año nuevo empieza el ${f(actual.fecha_fin)}, cuando vence el actual: no pierdes días por renovar antes.`;
            case 'gracia':
                return `El año nuevo cuenta desde el ${f(actual.fecha_inicio)}, cuando venció tu plan. Tu año de reserva sigue guardado.`;
            case 'reserva':
                return 'El año nuevo empieza hoy y lo que quedaba de tu año de reserva se pierde.';
            default:
                return actual.impago
                    ? 'El año empieza hoy y se cancela la eliminación programada de lo que excede el plan Gratuito.'
                    : 'El año empieza hoy.';
        }
    };

    const totalCompra = compra
        ? (compra.incluyePlan ? compra.plan.costo_anual : 0) + (compra.incluyeReserva ? compra.plan.costo_reserva : 0)
        : 0;

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
                    {/* Plan vencido con contenido que excede el Gratuito */}
                    {actual.impago && (
                        <div className={`impago-panel mb-4 ${actual.impago.estado === 'pausado' ? 'is-pausado' : ''}`}>
                            <h5 className="fw-bold mb-2">
                                <i className={`fas ${actual.impago.estado === 'pausado' ? 'fa-pause-circle' : 'fa-triangle-exclamation'} me-2`} />
                                {actual.impago.estado === 'pausado'
                                    ? 'Eliminación en pausa'
                                    : `Tu plan terminó: el ${f(actual.impago.recorte_en)} se eliminará lo que excede el plan Gratuito`}
                            </h5>
                            {actual.impago.estado === 'pausado' ? (
                                <p className="small mb-2">
                                    Tu plan terminó y tu contenido excede el plan Gratuito, pero no se borrará nada mientras
                                    tu Interruptor de Hombre Muerto no esté activo. Al confirmar que sigues con vida tendrás
                                    al menos 15 días antes de la eliminación.
                                </p>
                            ) : (
                                <p className="small mb-2">
                                    Estás en <strong>solo lectura</strong>: puedes ver y descargar todo, pero no subir ni crear
                                    más. Ese día se conservará la bóveda que elijas (o la de más custodios) y, dentro de ella,
                                    se borrarán primero los archivos más recientes hasta quedar en el límite. Lo eliminado no se
                                    puede recuperar.
                                </p>
                            )}
                            {actual.impago.excesos.length > 0 && (
                                <ul className="small mb-3">
                                    {actual.impago.excesos.map((e) => (
                                        <li key={e}>{e}</li>
                                    ))}
                                </ul>
                            )}
                            <div className="d-flex flex-wrap gap-2">
                                {planDePago && (
                                    <button className="btn btn-sm btn-ipn rounded-pill px-3" onClick={() => abrirCompra(planDePago, true, false)}>
                                        Renovar y conservar todo
                                    </button>
                                )}
                                <button className="btn btn-sm btn-outline-ipn rounded-pill px-3" onClick={() => navigate('/bovedas')}>
                                    {actual.impago.id_boveda_conservar ? 'Cambiar la bóveda a conservar' : 'Elegir qué bóveda conservar'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Consumo actual */}
                    <div className="config-card mb-4">
                        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                            <h5 className="fw-bold m-0">Tu consumo actual</h5>
                            <span className="plan-actual-chip">
                                <i className="fas fa-circle-check me-1" /> Plan {actual.plan.nombre}
                                {cobertura === 'pago' && ' · anual'}
                                {cobertura === 'gracia' && ' · en gracia'}
                                {cobertura === 'reserva' && ' · año de reserva'}
                            </span>
                        </div>

                        {cobertura === 'pago' && (
                            <div className={`vigencia-nota mb-3 ${cancelada ? 'is-cancelada' : ''}`}>
                                <span>
                                    <i className="fas fa-calendar-check me-2" />
                                    Vigente · vence el <strong>{f(actual.fecha_fin)}</strong>
                                    {actual.pagado_hasta && actual.pagado_hasta !== actual.fecha_fin && (
                                        <> · renovado hasta el <strong>{f(actual.pagado_hasta)}</strong></>
                                    )}
                                    .{cancelada && ' No recibirás avisos de renovación.'}
                                </span>
                                {actual.pagado_hasta === actual.fecha_fin &&
                                    (cancelada ? (
                                        <button className="btn btn-sm btn-outline-ipn rounded-pill" onClick={reactivar} disabled={reactivando}>
                                            {reactivando ? 'Aplicando…' : 'Volver a recibir avisos'}
                                        </button>
                                    ) : (
                                        <button className="btn btn-sm btn-link text-muted p-0" onClick={abrirCancelacion}>
                                            No pienso renovar
                                        </button>
                                    ))}
                            </div>
                        )}
                        {cobertura === 'gracia' && (
                            <div className="vigencia-nota is-cancelada mb-3">
                                <span>
                                    <i className="fas fa-hourglass-half me-2" />
                                    Tu plan venció el <strong>{f(actual.fecha_inicio)}</strong>. Periodo de gracia hasta el{' '}
                                    <strong>{f(actual.fecha_fin)}</strong>: si renuevas antes, tu año de reserva sigue guardado.
                                </span>
                            </div>
                        )}
                        {cobertura === 'reserva' && (
                            <div className="vigencia-nota is-cancelada mb-3">
                                <span>
                                    <i className="fas fa-shield-halved me-2" />
                                    Te cubre tu año de reserva hasta el <strong>{f(actual.fecha_fin)}</strong>. Al renovar,
                                    el año nuevo empieza ese día y la reserva restante se pierde.
                                </span>
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

                    {/* Año de reserva */}
                    {planDePago && (
                        <div className="config-card reserva-card mb-4">
                            <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
                                <div className="reserva-texto">
                                    <h5 className="fw-bold mb-1">
                                        <i className="fas fa-shield-halved me-2" />
                                        Año de reserva
                                        {actual.reserva && (
                                            <span className={`reserva-chip ms-2 ${actual.reserva.estado === 'activa' ? 'is-activa' : ''}`}>
                                                {actual.reserva.estado === 'activa' ? 'En uso' : 'Guardado'}
                                            </span>
                                        )}
                                    </h5>
                                    <p className="text-muted small mb-0">
                                        {actual.reserva?.estado === 'activa' ? (
                                            <>Te mantiene el plan {planDePago.nombre} completo hasta el <strong>{f(actual.reserva.cubre_hasta)}</strong>.</>
                                        ) : actual.reserva ? (
                                            <>
                                                Si un año no renuevas, tendrás 30 días de gracia y después la reserva te mantendrá el plan
                                                completo{actual.reserva.cubre_desde && <> del <strong>{f(actual.reserva.cubre_desde)}</strong> al <strong>{f(actual.reserva.cubre_hasta)}</strong></>}.
                                                Mientras renueves, sigue guardado.
                                            </>
                                        ) : (
                                            <>
                                                Por {money(planDePago.costo_reserva)} MXN, una sola vez: si un año no renuevas, tienes 30 días de gracia
                                                y después conservas el plan {planDePago.nombre} completo hasta cumplir 12 meses desde el vencimiento.
                                                Se usa una vez; después puedes comprar otro.
                                            </>
                                        )}
                                    </p>
                                </div>
                                {!actual.reserva && cobertura === 'pago' && (
                                    <button className="btn btn-outline-ipn rounded-pill px-4" onClick={() => abrirCompra(planDePago, false, true)}>
                                        Agregar · {money(planDePago.costo_reserva)}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Catálogo */}
                    <div className="row g-4 align-items-stretch justify-content-center">
                        {planes.map((p) => {
                            const esGratis = p.costo_anual === 0;
                            const vigente = p.id === actual.plan.id;
                            const featured = p.costo_anual === maxCosto && maxCosto > 0 && !vigente;
                            const porMes = p.costo_anual / 12;

                            return (
                                <div className="col-md-5 col-lg-4" key={p.id}>
                                    <div className={`pricing-card ${featured ? 'featured' : ''} ${vigente ? 'is-current' : ''}`}>
                                        {featured && <div className="plan-badge">Recomendado</div>}
                                        <h5 className="fw-bold mb-1">{p.nombre}</h5>
                                        <p className="text-muted small mb-0">{DESC[p.nombre] ?? 'Plan de resguardo.'}</p>
                                        <div className="price-tag">
                                            {money(p.costo_anual)} <small>/ {esGratis ? 'siempre' : 'año'}</small>
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
                                                <i className="fas fa-check-circle" /> Interruptor de Hombre Muerto y recuperación completos
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" />{' '}
                                                {esGratis ? 'Sin caducidad' : 'Pago anual, renovación manual'}
                                            </li>
                                            {p.costo_reserva > 0 && (
                                                <li>
                                                    <i className="fas fa-shield-halved" /> Año de reserva opcional (+{money(p.costo_reserva)})
                                                </li>
                                            )}
                                        </ul>

                                        {esGratis ? (
                                            <button className="btn-plan current-plan-indicator" disabled>
                                                {vigente ? (
                                                    <>
                                                        <i className="fas fa-circle-check me-2" /> Tu plan actual
                                                    </>
                                                ) : (
                                                    'Al terminar tu plan de pago'
                                                )}
                                            </button>
                                        ) : (
                                            accionPlan(p)
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
                                ? `Pagos con PayPal (${ppCfg.mode}) en ${ppCfg.currency}. El plan se paga una vez al año y no se cobra solo: te avisamos 30, 7 y 1 día antes de que venza. Si no renuevas pasas a Gratuito y lo que exceda sus límites se elimina 60 días después, salvo que tengas año de reserva.`
                                : 'PayPal no está configurado en este entorno: las compras se simulan.'}
                        </p>
                    </div>
                </>
            )}

            {/* Modal: compra (PayPal o simulada) */}
            {phase === 'compra' && compra && actual && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg suscripcion-modal">
                            <div className="modal-header-gradient" />
                            <div className="modal-body p-5">
                                <div className="text-center mb-3" style={{ color: 'var(--ipn-maroon)' }}>
                                    <i className={`fas ${compra.incluyePlan ? 'fa-crown' : 'fa-shield-halved'} fa-3x`} />
                                </div>
                                <h4 className="fw-bold mb-3 text-center">
                                    {compra.incluyePlan
                                        ? `${cobertura === 'gratuito' ? 'Contratar' : 'Renovar'} plan ${compra.plan.nombre}`
                                        : 'Agregar año de reserva'}
                                </h4>

                                <div className="compra-resumen mb-3">
                                    {compra.incluyePlan && (
                                        <div className="compra-linea">
                                            <span>Plan {compra.plan.nombre} · 1 año</span>
                                            <span>{money(compra.plan.costo_anual)}</span>
                                        </div>
                                    )}
                                    {compra.incluyePlan && reservaSumable(compra.plan) ? (
                                        <label className="compra-linea compra-opcion">
                                            <span>
                                                <input
                                                    type="checkbox"
                                                    className="form-check-input me-2"
                                                    checked={compra.incluyeReserva}
                                                    onChange={(e) => setCompra({ ...compra, incluyeReserva: e.target.checked })}
                                                />
                                                Año de reserva
                                            </span>
                                            <span>{money(compra.plan.costo_reserva)}</span>
                                        </label>
                                    ) : (
                                        !compra.incluyePlan && (
                                            <div className="compra-linea">
                                                <span>Año de reserva</span>
                                                <span>{money(compra.plan.costo_reserva)}</span>
                                            </div>
                                        )
                                    )}
                                    <div className="compra-linea compra-total">
                                        <span>Total</span>
                                        <span>
                                            {money(totalCompra)} {ppCfg?.currency ?? 'MXN'}
                                        </span>
                                    </div>
                                </div>

                                <ul className="text-muted small compra-notas">
                                    {notaInicio() && <li>{notaInicio()}</li>}
                                    {compra.incluyeReserva && (
                                        <li>
                                            La reserva se guarda mientras renueves cada año. Si un año no lo haces, tienes 30 días de
                                            gracia y después te mantiene el plan completo hasta cumplir 12 meses desde el vencimiento.
                                        </li>
                                    )}
                                    {!compra.incluyePlan && (
                                        <li>
                                            <strong>El cobro es hoy</strong>, aunque tu plan venza pronto. No cambia la fecha de tu plan
                                            ni sustituye la renovación: cuando toque, tu pago anual de {money(compra.plan.costo_anual)} se
                                            hace igual.
                                        </li>
                                    )}
                                    {!ppCfg?.configured && (
                                        <li>
                                            PayPal no está configurado; el pago se <strong>simulará</strong>.
                                        </li>
                                    )}
                                </ul>

                                {ppRenderErr && <div className="alert alert-danger py-2 small">{ppRenderErr}</div>}

                                {ppCfg?.configured ? (
                                    <>
                                        <div ref={ppBox} className="pp-buttons" />
                                        <div className="text-center">
                                            <button className="btn btn-link text-muted mt-2" onClick={cerrarModal}>
                                                Cancelar
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="d-flex gap-3">
                                        <button className="btn btn-light w-100 rounded-pill" onClick={cerrarModal}>
                                            Cancelar
                                        </button>
                                        <button className="btn btn-ipn w-100 rounded-pill" onClick={simularCompra}>
                                            Simular pago
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: dejar de recibir avisos de renovación */}
            {phase === 'cancelar' && actual && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg suscripcion-modal">
                            <div className="modal-header-gradient" />
                            <div className="modal-body p-5 text-center">
                                <div className="mb-3" style={{ color: 'var(--ipn-maroon)' }}>
                                    <i className="fas fa-bell-slash fa-3x" />
                                </div>
                                <h4 className="fw-bold mb-1">¿No piensas renovar?</h4>
                                <p className="text-muted small mb-4">
                                    No se cobra nada automáticamente, así que no hay nada que cancelar: solo dejarás de recibir los
                                    avisos de renovación. Conservas el plan {actual.plan.nombre} hasta el{' '}
                                    <strong>{f(actual.fecha_fin)}</strong>.
                                    {actual.reserva
                                        ? ' Después te cubrirán la gracia y tu año de reserva.'
                                        : ' Después pasarás a Gratuito y, si tu contenido excede sus límites, se eliminará lo que sobre 60 días más tarde.'}
                                </p>
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={cerrarModal}>
                                        Volver
                                    </button>
                                    <button className="btn btn-ipn w-100 rounded-pill" onClick={confirmarCancelacion}>
                                        No enviarme avisos
                                    </button>
                                </div>
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
                                            {hecho === 'avisos' ? 'Guardando tu preferencia…' : 'Aplicando tu compra…'}
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
                                        <h4 className="fw-bold">{hecho === 'avisos' ? 'Listo' : 'Compra aplicada'}</h4>
                                        <p className="text-muted small">
                                            {hecho === 'avisos' ? (
                                                'Ya no recibirás avisos de renovación.'
                                            ) : (
                                                <>
                                                    Tu plan <strong>{actual?.plan.nombre}</strong>
                                                    {actual?.pagado_hasta && ` está pagado hasta el ${f(actual.pagado_hasta)}`}
                                                    {actual?.reserva?.estado === 'disponible' && ' y tienes un año de reserva guardado'}.
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
