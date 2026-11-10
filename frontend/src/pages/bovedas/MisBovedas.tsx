import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { bovedasService } from '../../services/bovedas.service';
import { subscriptionService } from '../../services/subscription.service';
import { custodiosService } from '../../services/custodios.service';
import PrimerPasoCustodios from '../../components/PrimerPasoCustodios';
import { custodioNotificable, MIN_CUSTODIOS_BOVEDA, type CustodioResponse } from '../../types/custodios.types';
import { fechaCorta, type PlanActual } from '../../types/subscription.types';
import { useNotice } from '../../store/NoticeContext';
import { bovedaBadge, type BovedaResponse } from '../../types/bovedas.types';
import { getApiErrorMessage } from '../../utils/errors';
import { parseBackendDate } from '../../utils/dates';
import StorageMeter from '../../components/StorageMeter';
import './bovedas.css';

/** Fecha corta + hora (ej. "3 sep 2026, 14:22") para la tarjeta de bóveda. */
function formatFechaBoveda(iso: string | null): string {
    if (!iso) return '';
    return parseBackendDate(iso).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function PidRow({ pid }: { pid: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(pid);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard bloqueado: el usuario puede seleccionar el texto */
        }
    };
    return (
        <div className="pid-row" title="Identificador público de la bóveda">
            <span className="pid-label">PID</span>
            <code className="pid-value">{pid}</code>
            <button className="pid-copy" onClick={copy} aria-label="Copiar PID">
                <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`} />
            </button>
        </div>
    );
}

const BADGE_META = {
    protegida: { label: 'PROTEGIDA', icon: 'fa-lock', cls: 'protegida', iconBg: 'bg-success bg-opacity-10 text-success' },
    incompleta: { label: 'INCOMPLETA', icon: 'fa-user-clock', cls: 'incompleta', iconBg: 'bg-warning bg-opacity-10 text-warning' },
    borrador: { label: 'BORRADOR', icon: 'fa-pen-ruler', cls: 'borrador', iconBg: 'bg-secondary bg-opacity-10 text-secondary' },
} as const;

export default function MisBovedas() {
    const navigate = useNavigate();
    const [bovedas, setBovedas] = useState<BovedaResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [search, setSearch] = useState('');
    const { notifyError } = useNotice();

    const filteredBovedas = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return bovedas;
        return bovedas.filter(
            (b) =>
                b.nombre.toLowerCase().includes(q) ||
                (b.categoria ?? '').toLowerCase().includes(q) ||
                b.pid.toLowerCase().includes(q),
        );
    }, [bovedas, search]);

    // modal de borrado (pide contraseña de la CUENTA)
    const [toDelete, setToDelete] = useState<BovedaResponse | null>(null);
    const [password, setPassword] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [deleteErr, setDeleteErr] = useState('');

    // Plan vencido con más bóvedas de las que permite el Gratuito: cuáles se
    // conservarían si llega el recorte (la elegida, si no la de más custodios
    // y luego la más antigua — mismo orden que services/impago.py).
    const [susc, setSusc] = useState<PlanActual | null>(null);
    // Para avisar que el primer paso son los custodios (null = aún no se sabe).
    const [custodios, setCustodios] = useState<CustodioResponse[] | null>(null);
    useEffect(() => {
        custodiosService.list().then(setCustodios).catch(() => setCustodios(null));
    }, []);
    const faltanCustodios =
        custodios !== null && custodios.filter(custodioNotificable).length < MIN_CUSTODIOS_BOVEDA;
    const [eligiendo, setEligiendo] = useState<number | null>(null);
    useEffect(() => {
        subscriptionService.getActual().then(setSusc).catch(() => setSusc(null));
    }, []);
    const impago = susc?.impago ?? null;
    const conservadas = useMemo(() => {
        if (!impago || !susc || bovedas.length <= susc.plan.max_bovedas) return null;
        const elegida = impago.id_boveda_conservar;
        const orden = [...bovedas].sort(
            (a, b) =>
                Number(a.id !== elegida) - Number(b.id !== elegida) ||
                b.custodios_vinculados - a.custodios_vinculados ||
                (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
                a.id - b.id,
        );
        return new Set(orden.slice(0, susc.plan.max_bovedas).map((b) => b.id));
    }, [bovedas, impago, susc]);

    const conservar = async (id: number) => {
        setEligiendo(id);
        try {
            setSusc(await subscriptionService.conservarBoveda(id));
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo guardar tu elección.'));
        } finally {
            setEligiendo(null);
        }
    };

    const load = () => {
        setLoading(true);
        setLoadFailed(false);
        bovedasService
            .list()
            .then(setBovedas)
            .catch((e) => {
                setLoadFailed(true);
                notifyError(getApiErrorMessage(e, 'No se pudieron cargar las bóvedas.'));
            })
            .finally(() => setLoading(false));
    };
    useEffect(load, []);

    const handleDelete = async () => {
        if (!toDelete) return;
        setDeleting(true);
        setDeleteErr('');
        try {
            await bovedasService.remove(toDelete.id, password);
            setToDelete(null);
            setPassword('');
            load();
        } catch (e) {
            setDeleteErr(getApiErrorMessage(e, 'No se pudo eliminar la bóveda.'));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <DashboardLayout activeItem="bovedas" topBarLabel="Gestión de Activos">
            <div className="row align-items-center mb-4 g-3">
                <div className="col-md-7">
                    <h2 className="fw-bold mb-1">Mis Bóvedas</h2>
                    <p className="text-muted m-0">Administra tus activos y estados de protección.</p>
                </div>
                <div className="col-md-5">
                    <div className="storage-card">
                        <StorageMeter
                            label="Almacenamiento"
                            usado={bovedas[0]?.usado_bytes ?? 0}
                            cuota={bovedas[0]?.cuota_bytes ?? 0}
                        />
                    </div>
                </div>
            </div>

            <div className="d-flex justify-content-between align-items-center mb-4 gap-3 flex-wrap">
                {bovedas.length > 3 ? (
                    <div className="input-group input-group-sm" style={{ maxWidth: 320 }}>
                        <span className="input-group-text bg-white border-end-0">
                            <i className="fas fa-search text-muted" />
                        </span>
                        <input
                            type="text"
                            className="form-control border-start-0 shadow-none"
                            placeholder="Buscar por nombre, categoría o PID…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                ) : (
                    <div />
                )}
                <button className="btn btn-ipn" onClick={() => navigate('/bovedas/nueva')}>
                    <i className="fas fa-plus-circle me-2" /> Crear Nueva Bóveda
                </button>
            </div>

            {custodios && <PrimerPasoCustodios custodios={custodios} />}

            {conservadas && impago && (
                <div className="conservar-nota mb-4">
                    <i className="fas fa-triangle-exclamation me-2" />
                    Tu plan terminó y el plan Gratuito permite {susc?.plan.max_bovedas} bóveda
                    {susc?.plan.max_bovedas === 1 ? '' : 's'}.{' '}
                    {impago.estado === 'pausado'
                        ? 'La eliminación está en pausa mientras tu Interruptor de Hombre Muerto no esté activo.'
                        : <>El <strong>{fechaCorta(impago.recorte_en)}</strong> se eliminarán las demás con todos sus archivos.</>}{' '}
                    {impago.id_boveda_conservar
                        ? 'Ya elegiste cuál conservar; puedes cambiarla.'
                        : 'Si no eliges, se conservará la de más custodios (y, a igualdad, la más antigua).'}
                </div>
            )}

            {loading && <p className="text-muted">Cargando…</p>}

            {!loading && bovedas.length === 0 && !loadFailed && (
                <div className="config-card text-center text-muted py-5">
                    <i className="fas fa-vault fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }} />
                    {faltanCustodios
                        ? 'Aún no tienes bóvedas. Podrás crear la primera en cuanto tus custodios confirmen.'
                        : 'Aún no tienes bóvedas. Crea la primera con el botón de arriba.'}
                </div>
            )}

            {!loading && bovedas.length > 0 && filteredBovedas.length === 0 && (
                <p className="text-muted small">Sin resultados para «{search}».</p>
            )}

            <div className="row g-4">
                {filteredBovedas.map((b) => {
                    const badge = bovedaBadge(b);
                    const meta = BADGE_META[badge];
                    return (
                        <div className="col-md-4" key={b.id}>
                            <div className="vault-item-card">
                                <div>
                                    <div className="d-flex justify-content-between align-items-start">
                                        <div className={`type-icon ${meta.iconBg}`}>
                                            <i className={`fas ${meta.icon}`} />
                                        </div>
                                        <span className="k-n-badge">
                                            {b.umbral_k ?? '–'} / {b.total_fragmentos_n ?? '–'}
                                        </span>
                                    </div>
                                    <h5 className="fw-bold mb-1">{b.nombre}</h5>
                                    {conservadas && (
                                        <p className={`conservar-chip ${conservadas.has(b.id) ? 'is-conservada' : ''} mb-2`}>
                                            <i className={`fas ${conservadas.has(b.id) ? 'fa-shield-halved' : 'fa-trash-alt'} me-1`} />
                                            {conservadas.has(b.id) ? 'Se conservará' : 'Se eliminará'}
                                        </p>
                                    )}
                                    <p className={`badge-estado ${meta.cls} mb-2`}>
                                        <i className={`fas ${meta.icon} me-1`} /> {meta.label}
                                    </p>
                                    <p className="small text-muted mb-1">{b.categoria || 'Sin categoría'}</p>
                                    {b.created_at && (
                                        <p className="small text-muted mb-1" style={{ fontSize: '0.7rem' }}>
                                            <i className="fas fa-calendar-plus me-1" />
                                            Creada el {formatFechaBoveda(b.created_at)}
                                        </p>
                                    )}
                                    <PidRow pid={b.pid} />
                                    <p className="small text-muted mt-2 mb-2">
                                        {badge === 'borrador'
                                            ? 'Falta fragmentar la llave.'
                                            : badge === 'incompleta'
                                              ? `Faltan custodios (${b.custodios_vinculados}/${b.umbral_k}).`
                                              : `${b.custodios_vinculados} custodios vinculados.`}
                                    </p>
                                    <p className="pid-hint">
                                        <i className="fas fa-circle-info me-1" />
                                        Con este PID los custodios localizarán la bóveda — pero solo después de que el
                                        interruptor de hombre muerto libere la recuperación.
                                    </p>
                                </div>
                                {conservadas && !conservadas.has(b.id) && (
                                    <button
                                        className="btn btn-sm btn-outline-secondary w-100 mb-2"
                                        onClick={() => conservar(b.id)}
                                        disabled={eligiendo !== null}
                                    >
                                        {eligiendo === b.id ? 'Guardando…' : 'Conservar esta bóveda'}
                                    </button>
                                )}
                                <div className="d-flex gap-2">
                                    <button
                                        className={`btn btn-sm flex-grow-1 ${badge === 'protegida' ? 'btn-blue-manage' : 'btn-ipn'}`}
                                        onClick={() =>
                                            navigate(
                                                badge === 'protegida'
                                                    ? `/bovedas/${b.id}`
                                                    : `/bovedas/nueva?resume=${b.id}`,
                                            )
                                        }
                                    >
                                        {badge === 'protegida' ? 'Gestionar' : 'Configurar'}
                                    </button>
                                    <button
                                        className="btn btn-sm btn-outline-danger-soft"
                                        title="Eliminar"
                                        onClick={() => {
                                            setToDelete(b);
                                            setDeleteErr('');
                                            setPassword('');
                                        }}
                                    >
                                        <i className="fas fa-trash-alt" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {toDelete && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" style={{ background: 'var(--danger-red)' }} />
                            <div className="modal-body p-5 text-center">
                                <div className="mb-3 text-danger">
                                    <i className="fas fa-exclamation-triangle fa-3x" />
                                </div>
                                <h4 className="fw-bold">Acción crítica</h4>
                                <p className="text-muted small">
                                    Para eliminar <strong>{toDelete.nombre}</strong> ingresa la contraseña de tu
                                    cuenta. Se destruirán sus compromisos y vinculaciones de forma permanente.
                                </p>
                                {deleteErr && <div className="alert alert-danger py-2 small">{deleteErr}</div>}
                                <input
                                    type="password"
                                    className="form-control text-center shadow-none mb-4"
                                    placeholder="Contraseña de la cuenta"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                                <div className="d-flex gap-3">
                                    <button
                                        className="btn btn-light w-100 rounded-pill"
                                        onClick={() => setToDelete(null)}
                                        disabled={deleting}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        className="btn w-100 rounded-pill text-white"
                                        style={{ background: 'var(--danger-red)' }}
                                        onClick={handleDelete}
                                        disabled={deleting || !password}
                                    >
                                        {deleting ? 'Borrando…' : 'Borrar permanentemente'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}