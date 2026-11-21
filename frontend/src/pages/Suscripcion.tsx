import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import StorageMeter from '../components/StorageMeter';
import { subscriptionService, type PaypalConfig } from '../services/subscription.service';
import { loadPayPal } from '../services/paypal';
import { cuotaPlanBytes, fechaCorta, nombrePlan, tamanoPlan, type Compra, type Plan, type PlanActual } from '../types/subscription.types';
import { getApiErrorMessage } from '../utils/errors';
import { useAuth } from '../store/AuthContext';
import { useNotice } from '../store/NoticeContext';
import './Suscripcion.css';
import { getLang, locale, t } from '../i18n';

// idle -> (compra | cancelar) -> processing -> (done | error)
type Phase = 'idle' | 'compra' | 'cancelar' | 'processing' | 'done' | 'error';
type Hecho = 'compra' | 'avisos';

interface CompraEnCurso {
    plan: Plan;
    incluyePlan: boolean;
    incluyeReserva: boolean;
}

const descPlan = (nombre: string): string =>
    ({
        Gratuito: t('Protección básica personal.', 'Basic personal protection.'),
        Premium: t('Para un legado robusto y una red de confianza amplia.', 'For a robust legacy and a wide trust network.'),
    })[nombre] ?? t('Plan de resguardo.', 'Safekeeping plan.');

const money = (n: number) => (n === 0 ? '$0' : `$${Math.round(n).toLocaleString(locale())}`);

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
            .catch((e) => notifyError(getApiErrorMessage(e, t('No se pudo cargar tu suscripción.', "Couldn't load your subscription."))))
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
        ejecutar(() => subscriptionService.comprarSimulado(aCompra(compra)), 'compra', t('No se pudo completar la compra.', "Couldn't complete the purchase."));
    };

    const confirmarCancelacion = () =>
        ejecutar(subscriptionService.cancelar, 'avisos', t('No se pudo guardar tu preferencia.', "Couldn't save your preference."));

    const reactivar = async () => {
        setReactivando(true);
        try {
            setActual(await subscriptionService.reactivar());
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo guardar tu preferencia.', "Couldn't save your preference.")));
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
            setModalErr(getApiErrorMessage(e, t('El pago se aprobó pero no se pudo aplicar la compra.', "The payment was approved but the purchase couldn't be applied.")));
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
                            setPpRenderErr(getApiErrorMessage(err, t('PayPal no pudo procesar el pago.', "PayPal couldn't process the payment.")));
                        },
                    })
                    .render(ppBox.current);
            })
            .catch((e) => {
                if (!cancelado) setPpRenderErr(getApiErrorMessage(e, t('No se pudo cargar PayPal.', "Couldn't load PayPal.")));
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

        if (cobertura === 'gratuito') return solido(t('Contratar', 'Subscribe'), comprar);
        if (planCubierto && p.id !== planCubierto.id) return inactivo(t('No disponible con tu plan actual', 'Not available with your current plan'));
        if (cobertura === 'gracia' || cobertura === 'reserva') return solido(t('Renovar ahora', 'Renew now'), comprar);
        if (actual.puede_renovar) return solido(t('Renovar un año más', 'Renew for another year'), comprar);
        if (actual.renovable_desde)
            return inactivo(t(`Renovable desde el ${f(actual.renovable_desde)}`, `Renewable from ${f(actual.renovable_desde)}`));
        return inactivo(t(`Renovado hasta el ${f(actual.pagado_hasta)}`, `Renewed until ${f(actual.pagado_hasta)}`));
    };

    /** Explicación de desde cuándo cuenta el año que se compra. */
    const notaInicio = () => {
        if (!actual || !compra?.incluyePlan) return null;
        switch (cobertura) {
            case 'pago':
                return t(
                    `El año nuevo empieza el ${f(actual.fecha_fin)}, cuando vence el actual: no pierdes días por renovar antes.`,
                    `The new year starts on ${f(actual.fecha_fin)}, when the current one expires: you don't lose days by renewing early.`,
                );
            case 'gracia':
                return t(
                    `El año nuevo cuenta desde el ${f(actual.fecha_inicio)}, cuando venció tu plan. Tu año de reserva sigue guardado.`,
                    `The new year counts from ${f(actual.fecha_inicio)}, when your plan expired. Your reserve year stays saved.`,
                );
            case 'reserva':
                return t(
                    'El año nuevo empieza hoy y lo que quedaba de tu año de reserva se pierde.',
                    'The new year starts today and whatever was left of your reserve year is lost.',
                );
            default:
                return actual.impago
                    ? t(
                          'El año empieza hoy y se cancela la eliminación programada de lo que excede el plan Gratuito.',
                          'The year starts today and the scheduled deletion of anything beyond the Free plan is cancelled.',
                      )
                    : t('El año empieza hoy.', 'The year starts today.');
        }
    };

    const es = getLang() === 'es';
    const totalCompra = compra
        ? (compra.incluyePlan ? compra.plan.costo_anual : 0) + (compra.incluyeReserva ? compra.plan.costo_reserva : 0)
        : 0;

    return (
        <DashboardLayout activeItem="suscripcion" topBarLabel={t('Planes y Facturación', 'Plans & Billing')}>
            <div className="text-center mb-4">
                <h2 className="fw-bold mb-1">{t('Protege tu legado digital', 'Protect your digital legacy')}</h2>
                <p className="text-muted m-0">
                    {t('Escala tu seguridad según tus necesidades de resguardo y red de confianza.', 'Scale your security to your safekeeping needs and trust network.')}
                </p>
            </div>

            {loading && <p className="text-muted">{t('Cargando…', 'Loading…')}</p>}

            {!loading && actual && (
                <>
                    {/* Plan vencido con contenido que excede el Gratuito */}
                    {actual.impago && (
                        <div className={`impago-panel mb-4 ${actual.impago.estado === 'pausado' ? 'is-pausado' : ''}`}>
                            <h5 className="fw-bold mb-2">
                                <i className={`fas ${actual.impago.estado === 'pausado' ? 'fa-pause-circle' : 'fa-triangle-exclamation'} me-2`} />
                                {actual.impago.estado === 'pausado'
                                    ? t('Eliminación en pausa', 'Deletion paused')
                                    : t(
                                          `Tu plan terminó: el ${f(actual.impago.recorte_en)} se eliminará lo que excede el plan Gratuito`,
                                          `Your plan ended: on ${f(actual.impago.recorte_en)} anything beyond the Free plan will be deleted`,
                                      )}
                            </h5>
                            {actual.impago.estado === 'pausado' ? (
                                <p className="small mb-2">
                                    {t('Tu plan terminó y tu contenido excede el plan Gratuito, pero no se borrará nada mientras tu protocolo de vida no esté activo. Al confirmar que sigues con vida tendrás al menos 15 días antes de la eliminación.', "Your plan ended and your content exceeds the Free plan, but nothing will be deleted while your life protocol isn't active. Once you confirm you're alive you'll have at least 15 days before the deletion.")}
                                </p>
                            ) : es ? (
                                    <p className="small mb-2">
                                        Estás en <strong>solo lectura</strong>: puedes ver y descargar todo, pero no subir ni crear
                                        más. Ese día se conservará la bóveda que elijas (o la de más custodios) y, dentro de ella,
                                        se borrarán primero los archivos más recientes hasta quedar en el límite. Lo eliminado no se
                                        puede recuperar.
                                    </p>
                                ) : (
                                    <p className="small mb-2">
                                        You're in <strong>read-only</strong> mode: you can view and download everything, but not
                                        upload or create more. On that day the vault you choose (or the one with the most
                                        custodians) is kept and, within it, the newest files are deleted first until it fits the
                                        limit. Deleted content can't be recovered.
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
                                        {t('Renovar y conservar todo', 'Renew and keep everything')}
                                    </button>
                                )}
                                <button className="btn btn-sm btn-outline-ipn rounded-pill px-3" onClick={() => navigate('/bovedas')}>
                                    {actual.impago.id_boveda_conservar ? t('Cambiar la bóveda a conservar', 'Change the vault to keep') : t('Elegir qué bóveda conservar', 'Choose which vault to keep')}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Consumo actual */}
                    <div className="config-card mb-4">
                        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                            <h5 className="fw-bold m-0">{t('Tu consumo actual', 'Your current usage')}</h5>
                            <span className="plan-actual-chip">
                                <i className="fas fa-circle-check me-1" /> Plan {nombrePlan(actual.plan.nombre)}
                                {cobertura === 'pago' && t(' · anual', ' · yearly')}
                                {cobertura === 'gracia' && t(' · en gracia', ' · in grace')}
                                {cobertura === 'reserva' && t(' · año de reserva', ' · reserve year')}
                            </span>
                        </div>

                        {cobertura === 'pago' && (
                            <div className={`vigencia-nota mb-3 ${cancelada ? 'is-cancelada' : ''}`}>
                                <span>
                                    <i className="fas fa-calendar-check me-2" />
                                    {t('Vigente · vence el', 'Active · expires on')} <strong>{f(actual.fecha_fin)}</strong>
                                    {actual.pagado_hasta && actual.pagado_hasta !== actual.fecha_fin && (
                                        <> · {t('renovado hasta el', 'renewed until')} <strong>{f(actual.pagado_hasta)}</strong></>
                                    )}
                                    .{cancelada && t(' No recibirás avisos de renovación.', " You won't receive renewal reminders.")}
                                </span>
                                {actual.pagado_hasta === actual.fecha_fin &&
                                    (cancelada ? (
                                        <button className="btn btn-sm btn-outline-ipn rounded-pill" onClick={reactivar} disabled={reactivando}>
                                            {reactivando ? t('Aplicando…', 'Applying…') : t('Volver a recibir avisos', 'Receive reminders again')}
                                        </button>
                                    ) : (
                                        <button className="btn btn-sm btn-link text-muted p-0" onClick={abrirCancelacion}>
                                            {t('No pienso renovar', "I don't plan to renew")}
                                        </button>
                                    ))}
                            </div>
                        )}
                        {cobertura === 'gracia' && (
                            <div className="vigencia-nota is-cancelada mb-3">
                                <span>
                                    <i className="fas fa-hourglass-half me-2" />
                                    {es ? (
                                        <>
                                            Tu plan venció el <strong>{f(actual.fecha_inicio)}</strong>. Periodo de gracia hasta el{' '}
                                            <strong>{f(actual.fecha_fin)}</strong>: si renuevas antes, tu año de reserva sigue guardado.
                                        </>
                                    ) : (
                                        <>
                                            Your plan expired on <strong>{f(actual.fecha_inicio)}</strong>. Grace period until{' '}
                                            <strong>{f(actual.fecha_fin)}</strong>: if you renew before then, your reserve year stays
                                            saved.
                                        </>
                                    )}
                                </span>
                            </div>
                        )}
                        {cobertura === 'reserva' && (
                            <div className="vigencia-nota is-cancelada mb-3">
                                <span>
                                    <i className="fas fa-shield-halved me-2" />
                                    {es ? (
                                        <>
                                            Te cubre tu año de reserva hasta el <strong>{f(actual.fecha_fin)}</strong>. Al renovar,
                                            el año nuevo empieza ese día y la reserva restante se pierde.
                                        </>
                                    ) : (
                                        <>
                                            Your reserve year covers you until <strong>{f(actual.fecha_fin)}</strong>. If you renew,
                                            the new year starts that day and the remaining reserve is lost.
                                        </>
                                    )}
                                </span>
                            </div>
                        )}

                        <StorageMeter
                            label={t('Almacenamiento', 'Storage')}
                            usado={actual.uso.almacenamiento_bytes}
                            cuota={cuotaPlanBytes(actual.plan)}
                        />
                        <div className="row g-3 mt-1">
                            <div className="col-sm-6">
                                <div className="uso-mini">
                                    <span className="uso-mini-label">{t('Bóvedas', 'Vaults')}</span>
                                    <span className="uso-mini-val">
                                        {actual.uso.bovedas} <small>/ {actual.plan.max_bovedas}</small>
                                    </span>
                                </div>
                            </div>
                            <div className="col-sm-6">
                                <div className="uso-mini">
                                    <span className="uso-mini-label">{t('Custodios', 'Custodians')}</span>
                                    <span className="uso-mini-val">
                                        {actual.uso.custodios} <small>/ {actual.plan.max_custodios} + {t('1 de reemplazo', '1 replacement')}</small>
                                    </span>
                                </div>
                            </div>
                            {actual.plan.max_archivos !== null && (
                                <div className="col-sm-6">
                                    <div className="uso-mini">
                                        <span className="uso-mini-label">{t('Archivos (las plantillas no cuentan)', "Files (templates don't count)")}</span>
                                        <span className="uso-mini-val">
                                            {actual.uso.archivos} <small>/ {actual.plan.max_archivos}</small>
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Año de reserva */}
                    {planDePago && (
                        <div className="config-card reserva-card mb-4">
                            <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
                                <div className="reserva-texto">
                                    <h5 className="fw-bold mb-1">
                                        <i className="fas fa-shield-halved me-2" />
                                        {t('Año de reserva', 'Reserve year')}
                                        {actual.reserva && (
                                            <span className={`reserva-chip ms-2 ${actual.reserva.estado === 'activa' ? 'is-activa' : ''}`}>
                                                {actual.reserva.estado === 'activa' ? t('En uso', 'In use') : t('Guardado', 'Saved')}
                                            </span>
                                        )}
                                    </h5>
                                    <p className="text-muted small mb-0">
                                        {actual.reserva?.estado === 'activa' ? (
                                            es ? (
                                                <>Te mantiene el plan {planDePago.nombre} completo hasta el <strong>{f(actual.reserva.cubre_hasta)}</strong>.</>
                                            ) : (
                                                <>It keeps your full {planDePago.nombre} plan until <strong>{f(actual.reserva.cubre_hasta)}</strong>.</>
                                            )
                                        ) : actual.reserva ? (
                                            es ? (
                                                <>
                                                    Si un año no renuevas, tendrás 30 días de gracia y después la reserva te mantendrá el plan
                                                    completo{actual.reserva.cubre_desde && <> del <strong>{f(actual.reserva.cubre_desde)}</strong> al <strong>{f(actual.reserva.cubre_hasta)}</strong></>}.
                                                    Mientras renueves, sigue guardado.
                                                </>
                                            ) : (
                                                <>
                                                    If you don't renew one year, you'll get 30 days of grace and then the reserve keeps your full
                                                    plan{actual.reserva.cubre_desde && <> from <strong>{f(actual.reserva.cubre_desde)}</strong> to <strong>{f(actual.reserva.cubre_hasta)}</strong></>}.
                                                    As long as you renew, it stays saved.
                                                </>
                                            )
                                        ) : es ? (
                                            <>
                                                Por {money(planDePago.costo_reserva)} MXN, una sola vez: si un año no renuevas, tienes 30 días de gracia
                                                y después conservas el plan {planDePago.nombre} completo hasta cumplir 12 meses desde el vencimiento.
                                                Se usa una vez; después puedes comprar otro.
                                            </>
                                        ) : (
                                            <>
                                                For {money(planDePago.costo_reserva)} MXN, one time: if you don't renew one year, you get 30 days of
                                                grace and then keep your full {planDePago.nombre} plan until 12 months after it expired. It's used once;
                                                afterwards you can buy another.
                                            </>
                                        )}
                                    </p>
                                </div>
                                {!actual.reserva && cobertura === 'pago' && (
                                    <button className="btn btn-outline-ipn rounded-pill px-4" onClick={() => abrirCompra(planDePago, false, true)}>
                                        {t('Agregar', 'Add')} · {money(planDePago.costo_reserva)}
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
                                        {featured && <div className="plan-badge">{t('Recomendado', 'Recommended')}</div>}
                                        <h5 className="fw-bold mb-1">{nombrePlan(p.nombre)}</h5>
                                        <p className="text-muted small mb-0">{descPlan(p.nombre)}</p>
                                        <div className="price-tag">
                                            {money(p.costo_anual)} <small>/ {esGratis ? t('siempre', 'forever') : t('año', 'year')}</small>
                                        </div>
                                        {porMes > 0 && <p className="price-sub">≈ {money(porMes)}/{t('mes', 'month')}</p>}

                                        <ul className="feature-list">
                                            <li>
                                                <i className="fas fa-check-circle" />{' '}
                                                {p.max_bovedas === 1
                                                    ? t('1 bóveda segura', '1 secure vault')
                                                    : t(`${p.max_bovedas} bóvedas seguras`, `${p.max_bovedas} secure vaults`)}
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" /> {tamanoPlan(p.max_almacenamiento_mb)} {t('de almacenamiento', 'of storage')}
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" />{' '}
                                                {t(`Hasta ${p.max_custodios} custodios (+1 de reemplazo)`, `Up to ${p.max_custodios} custodians (+1 replacement)`)}
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" />{' '}
                                                {p.max_archivos === null
                                                    ? t('Archivos sin límite de cantidad', 'Unlimited number of files')
                                                    : t(
                                                          `Hasta ${p.max_archivos} archivos (fotos, videos, audio o documentos)`,
                                                          `Up to ${p.max_archivos} files (photos, videos, audio or documents)`,
                                                      )}
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" /> {t('Plantillas de credenciales ilimitadas', 'Unlimited credential templates')}
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" /> {t('Protocolo de vida y recuperación completos', 'Full life protocol and recovery')}
                                            </li>
                                            <li>
                                                <i className="fas fa-check-circle" />{' '}
                                                {esGratis ? t('Sin caducidad', 'Never expires') : t('Pago anual, renovación manual', 'Yearly payment, manual renewal')}
                                            </li>
                                            {p.costo_reserva > 0 && (
                                                <li>
                                                    <i className="fas fa-shield-halved" /> {t('Año de reserva opcional', 'Optional reserve year')} (+{money(p.costo_reserva)})
                                                </li>
                                            )}
                                        </ul>

                                        {esGratis ? (
                                            <button className="btn-plan current-plan-indicator" disabled>
                                                {vigente ? (
                                                    <>
                                                        <i className="fas fa-circle-check me-2" /> {t('Tu plan actual', 'Your current plan')}
                                                    </>
                                                ) : (
                                                    t('Al terminar tu plan de pago', 'When your paid plan ends')
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
                                ? t(
                                      `Pagos con PayPal (${ppCfg.mode}) en ${ppCfg.currency}. El plan se paga una vez al año y no se cobra solo: te avisamos 30, 7 y 1 día antes de que venza. Si no renuevas pasas a Gratuito y lo que exceda sus límites se elimina 60 días después, salvo que tengas año de reserva.`,
                                      `Payments with PayPal (${ppCfg.mode}) in ${ppCfg.currency}. The plan is paid once a year and is never charged automatically: we remind you 30, 7 and 1 day before it expires. If you don't renew you move to Free and anything beyond its limits is deleted 60 days later, unless you have a reserve year.`,
                                  )
                                : t('PayPal no está configurado en este entorno: las compras se simulan.', 'PayPal is not configured in this environment: purchases are simulated.')}
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
                                        ? cobertura === 'gratuito'
                                            ? t(`Contratar plan ${compra.plan.nombre}`, `Subscribe to the ${compra.plan.nombre} plan`)
                                            : t(`Renovar plan ${compra.plan.nombre}`, `Renew the ${compra.plan.nombre} plan`)
                                        : t('Agregar año de reserva', 'Add reserve year')}
                                </h4>

                                <div className="compra-resumen mb-3">
                                    {compra.incluyePlan && (
                                        <div className="compra-linea">
                                            <span>Plan {compra.plan.nombre} · {t('1 año', '1 year')}</span>
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
                                                {t('Año de reserva', 'Reserve year')}
                                            </span>
                                            <span>{money(compra.plan.costo_reserva)}</span>
                                        </label>
                                    ) : (
                                        !compra.incluyePlan && (
                                            <div className="compra-linea">
                                                <span>{t('Año de reserva', 'Reserve year')}</span>
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
                                            {t('La reserva se guarda mientras renueves cada año. Si un año no lo haces, tienes 30 días de gracia y después te mantiene el plan completo hasta cumplir 12 meses desde el vencimiento.', "The reserve stays saved as long as you renew every year. If one year you don't, you get 30 days of grace and then it keeps your full plan until 12 months after it expired.")}
                                        </li>
                                    )}
                                    {!compra.incluyePlan &&
                                        (es ? (
                                        <li>
                                            <strong>El cobro es hoy</strong>, aunque tu plan venza pronto. No cambia la fecha de tu plan
                                            ni sustituye la renovación: cuando toque, tu pago anual de {money(compra.plan.costo_anual)} se
                                            hace igual.
                                        </li>
                                    ) : (
                                        <li>
                                            <strong>The charge is today</strong>, even if your plan expires soon. It doesn't change your
                                            plan's date or replace the renewal: when it's due, your yearly payment of{' '}
                                            {money(compra.plan.costo_anual)} still applies.
                                        </li>
                                    ))}
                                    {!ppCfg?.configured && (
                                        <li>
                                            {es ? (
                                                <>PayPal no está configurado; el pago se <strong>simulará</strong>.</>
                                            ) : (
                                                <>PayPal is not configured; the payment will be <strong>simulated</strong>.</>
                                            )}
                                        </li>
                                    )}
                                </ul>

                                {ppRenderErr && <div className="alert alert-danger py-2 small">{ppRenderErr}</div>}

                                {ppCfg?.configured ? (
                                    <>
                                        <div ref={ppBox} className="pp-buttons" />
                                        <div className="text-center">
                                            <button className="btn btn-link text-muted mt-2" onClick={cerrarModal}>
                                                {t('Cancelar', 'Cancel')}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="d-flex gap-3">
                                        <button className="btn btn-light w-100 rounded-pill" onClick={cerrarModal}>
                                            {t('Cancelar', 'Cancel')}
                                        </button>
                                        <button className="btn btn-ipn w-100 rounded-pill" onClick={simularCompra}>
                                            {t('Simular pago', 'Simulate payment')}
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
                                <h4 className="fw-bold mb-1">{t('¿No piensas renovar?', "Don't plan to renew?")}</h4>
                                {es ? (
                                    <p className="text-muted small mb-4">
                                        No se cobra nada automáticamente, así que no hay nada que cancelar: solo dejarás de recibir los
                                        avisos de renovación. Conservas el plan {actual.plan.nombre} hasta el{' '}
                                        <strong>{f(actual.fecha_fin)}</strong>.
                                        {actual.reserva
                                            ? ' Después te cubrirán la gracia y tu año de reserva.'
                                            : ' Después pasarás a Gratuito y, si tu contenido excede sus límites, se eliminará lo que sobre 60 días más tarde.'}
                                    </p>
                                ) : (
                                    <p className="text-muted small mb-4">
                                        Nothing is charged automatically, so there's nothing to cancel: you'll just stop receiving
                                        renewal reminders. You keep the {actual.plan.nombre} plan until{' '}
                                        <strong>{f(actual.fecha_fin)}</strong>.
                                        {actual.reserva
                                            ? ' After that, the grace period and your reserve year will cover you.'
                                            : ' After that you move to Free and, if your content exceeds its limits, the excess is deleted 60 days later.'}
                                    </p>
                                )}
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={cerrarModal}>
                                        {t('Volver', 'Back')}
                                    </button>
                                    <button className="btn btn-ipn w-100 rounded-pill" onClick={confirmarCancelacion}>
                                        {t('No enviarme avisos', "Don't send me reminders")}
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
                                        <h4 className="fw-bold">{t('Procesando', 'Processing')}</h4>
                                        <p className="text-muted small">
                                            {hecho === 'avisos' ? t('Guardando tu preferencia…', 'Saving your preference…') : t('Aplicando tu compra…', 'Applying your purchase…')}
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
                                        <h4 className="fw-bold">{hecho === 'avisos' ? t('Listo', 'Done') : t('Compra aplicada', 'Purchase applied')}</h4>
                                        <p className="text-muted small">
                                            {hecho === 'avisos' ? (
                                                t('Ya no recibirás avisos de renovación.', "You won't receive renewal reminders anymore.")
                                            ) : (
                                                <>
                                                    {t('Tu plan', 'Your plan')} <strong>{actual?.plan.nombre}</strong>
                                                    {actual?.pagado_hasta &&
                                                        t(` está pagado hasta el ${f(actual.pagado_hasta)}`, ` is paid until ${f(actual.pagado_hasta)}`)}
                                                    {actual?.reserva?.estado === 'disponible' &&
                                                        t(' y tienes un año de reserva guardado', ' and you have a reserve year saved')}
                                                    .
                                                </>
                                            )}
                                        </p>
                                        <button className="btn btn-ipn rounded-pill px-5 mt-2" onClick={cerrarModal}>
                                            {t('Listo', 'Done')}
                                        </button>
                                    </>
                                )}

                                {phase === 'error' && (
                                    <>
                                        <div className="mb-3 text-danger">
                                            <i className="fas fa-triangle-exclamation fa-3x" />
                                        </div>
                                        <h4 className="fw-bold">{t('No se pudo completar', "Couldn't complete")}</h4>
                                        <p className="text-muted small">{modalErr}</p>
                                        <button className="btn btn-light w-100 rounded-pill mt-2" onClick={cerrarModal}>
                                            {t('Cerrar', 'Close')}
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
