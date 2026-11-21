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
import { bovedaBadge, categoriaLabel, type BovedaResponse } from '../../types/bovedas.types';
import { getApiErrorMessage } from '../../utils/errors';
import { parseBackendDate } from '../../utils/dates';
import StorageMeter from '../../components/StorageMeter';
import './bovedas.css';
import { getLang, locale, t } from '../../i18n';

/** Fecha corta + hora (ej. "3 sep 2026, 14:22") para la tarjeta de bóveda. */
function formatFechaBoveda(iso: string | null): string {
    if (!iso) return '';
    return parseBackendDate(iso).toLocaleString(locale(), {
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
        <div className="pid-row" title={t('Código de la bóveda: con él tus custodios la encuentran', 'Vault code: your custodians use it to find the vault')}>
            <span className="pid-label">{t('Código', 'Code')}</span>
            <code className="pid-value">{pid}</code>
            <button className="pid-copy" onClick={copy} aria-label={t('Copiar código', 'Copy code')}>
                <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`} />
            </button>
        </div>
    );
}

const badgeMeta = (b: 'protegida' | 'incompleta' | 'borrador') =>
    ({
        protegida: { label: t('PROTEGIDA', 'PROTECTED'), icon: 'fa-lock', cls: 'protegida', iconBg: 'bg-success bg-opacity-10 text-success' },
        incompleta: { label: t('INCOMPLETA', 'INCOMPLETE'), icon: 'fa-user-clock', cls: 'incompleta', iconBg: 'bg-warning bg-opacity-10 text-warning' },
        borrador: { label: t('BORRADOR', 'DRAFT'), icon: 'fa-pen-ruler', cls: 'borrador', iconBg: 'bg-secondary bg-opacity-10 text-secondary' },
    })[b];

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
                categoriaLabel(b.categoria ?? '').toLowerCase().includes(q) ||
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
            notifyError(getApiErrorMessage(e, t('No se pudo guardar tu elección.', "Couldn't save your choice.")));
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
                notifyError(getApiErrorMessage(e, t('No se pudieron cargar las bóvedas.', "Couldn't load the vaults.")));
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
            setDeleteErr(getApiErrorMessage(e, t('No se pudo eliminar la bóveda.', "Couldn't delete the vault.")));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <DashboardLayout activeItem="bovedas" topBarLabel={t('Gestión de Activos', 'Asset Management')}>
            <div className="row align-items-center mb-4 g-3">
                <div className="col-md-7">
                    <h2 className="fw-bold mb-1">{t('Mis Bóvedas', 'My Vaults')}</h2>
                    <p className="text-muted m-0">{t('Administra tus activos y estados de protección.', 'Manage your assets and protection status.')}</p>
                </div>
                <div className="col-md-5">
                    <div className="storage-card">
                        <StorageMeter
                            label={t('Almacenamiento', 'Storage')}
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
                            placeholder={t('Buscar por nombre, categoría o código…', 'Search by name, category or code…')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                ) : (
                    <div />
                )}
                <button className="btn btn-ipn" onClick={() => navigate('/bovedas/nueva')}>
                    <i className="fas fa-plus-circle me-2" /> {t('Crear Nueva Bóveda', 'Create New Vault')}
                </button>
            </div>

            {custodios && <PrimerPasoCustodios custodios={custodios} />}

            {conservadas && impago && (
                <div className="conservar-nota mb-4">
                    <i className="fas fa-triangle-exclamation me-2" />
                    {getLang() === 'es' ? (
                        <>
                            Tu plan terminó y el plan Gratuito permite {susc?.plan.max_bovedas} bóveda
                            {susc?.plan.max_bovedas === 1 ? '' : 's'}.{' '}
                            {impago.estado === 'pausado'
                                ? 'La eliminación está en pausa mientras tu protocolo de vida no esté activo.'
                                : <>El <strong>{fechaCorta(impago.recorte_en)}</strong> se eliminarán las demás con todos sus archivos.</>}{' '}
                            {impago.id_boveda_conservar
                                ? 'Ya elegiste cuál conservar; puedes cambiarla.'
                                : 'Si no eliges, se conservará la de más custodios (y, a igualdad, la más antigua).'}
                        </>
                    ) : (
                        <>
                            Your plan ended and the Free plan allows {susc?.plan.max_bovedas} vault
                            {susc?.plan.max_bovedas === 1 ? '' : 's'}.{' '}
                            {impago.estado === 'pausado'
                                ? "Deletion is paused while your life protocol isn't active."
                                : <>On <strong>{fechaCorta(impago.recorte_en)}</strong> the others will be deleted with all their files.</>}{' '}
                            {impago.id_boveda_conservar
                                ? 'You already chose which one to keep; you can change it.'
                                : "If you don't choose, the one with the most custodians (and, if tied, the oldest) is kept."}
                        </>
                    )}
                </div>
            )}

            {loading && <p className="text-muted">{t('Cargando…', 'Loading…')}</p>}

            {!loading && bovedas.length === 0 && !loadFailed && (
                <div className="config-card text-center text-muted py-5">
                    <i className="fas fa-vault fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }} />
                    {faltanCustodios
                        ? t('Aún no tienes bóvedas. Podrás crear la primera en cuanto tus custodios confirmen.', "You don't have any vaults yet. You can create the first one once your custodians confirm.")
                        : t('Aún no tienes bóvedas. Crea la primera con el botón de arriba.', "You don't have any vaults yet. Create the first one with the button above.")}
                </div>
            )}

            {!loading && bovedas.length > 0 && filteredBovedas.length === 0 && (
                <p className="text-muted small">{t('Sin resultados para', 'No results for')} «{search}».</p>
            )}

            <div className="row g-4">
                {filteredBovedas.map((b) => {
                    const badge = bovedaBadge(b);
                    const meta = badgeMeta(badge);
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
                                            {conservadas.has(b.id) ? t('Se conservará', 'Will be kept') : t('Se eliminará', 'Will be deleted')}
                                        </p>
                                    )}
                                    <p className={`badge-estado ${meta.cls} mb-2`}>
                                        <i className={`fas ${meta.icon} me-1`} /> {meta.label}
                                    </p>
                                    <p className="small text-muted mb-1">{b.categoria ? categoriaLabel(b.categoria) : t('Sin categoría', 'No category')}</p>
                                    {b.created_at && (
                                        <p className="small text-muted mb-1" style={{ fontSize: '0.7rem' }}>
                                            <i className="fas fa-calendar-plus me-1" />
                                            {t('Creada el', 'Created on')} {formatFechaBoveda(b.created_at)}
                                        </p>
                                    )}
                                    <PidRow pid={b.pid} />
                                    <p className="small text-muted mt-2 mb-2">
                                        {badge === 'borrador'
                                            ? t('Falta fragmentar la llave.', 'The key still needs to be split.')
                                            : badge === 'incompleta'
                                              ? t(`Faltan custodios (${b.custodios_vinculados}/${b.umbral_k}).`, `Custodians missing (${b.custodios_vinculados}/${b.umbral_k}).`)
                                              : t(`${b.custodios_vinculados} custodios vinculados.`, `${b.custodios_vinculados} custodians linked.`)}
                                    </p>
                                    <p className="pid-hint">
                                        <i className="fas fa-circle-info me-1" />
                                        {t('Con este código tus custodios encontrarán la bóveda, pero solo cuando el protocolo de vida active la recuperación.', 'With this code your custodians will find the vault, but only once the life protocol triggers recovery.')}
                                    </p>
                                </div>
                                {conservadas && !conservadas.has(b.id) && (
                                    <button
                                        className="btn btn-sm btn-outline-secondary w-100 mb-2"
                                        onClick={() => conservar(b.id)}
                                        disabled={eligiendo !== null}
                                    >
                                        {eligiendo === b.id ? t('Guardando…', 'Saving…') : t('Conservar esta bóveda', 'Keep this vault')}
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
                                        {badge === 'protegida' ? t('Gestionar', 'Manage') : t('Configurar', 'Set up')}
                                    </button>
                                    <button
                                        className="btn btn-sm btn-outline-danger-soft"
                                        title={t('Eliminar', 'Delete')}
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
                                <h4 className="fw-bold">{t('Acción crítica', 'Critical action')}</h4>
                                {getLang() === 'es' ? (
                                    <p className="text-muted small">
                                        Para eliminar <strong>{toDelete.nombre}</strong> ingresa la contraseña de tu
                                        cuenta. Se borrarán sus archivos y sus custodios dejarán de estar vinculados. No se puede deshacer.
                                    </p>
                                ) : (
                                    <p className="text-muted small">
                                        To delete <strong>{toDelete.nombre}</strong> enter your account password. Its files
                                        will be deleted and its custodians will be unlinked. This can't be undone.
                                    </p>
                                )}
                                {deleteErr && <div className="alert alert-danger py-2 small">{deleteErr}</div>}
                                <input
                                    type="password"
                                    className="form-control text-center shadow-none mb-4"
                                    placeholder={t('Contraseña de la cuenta', 'Account password')}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                                <div className="d-flex gap-3">
                                    <button
                                        className="btn btn-light w-100 rounded-pill"
                                        onClick={() => setToDelete(null)}
                                        disabled={deleting}
                                    >
                                        {t('Cancelar', 'Cancel')}
                                    </button>
                                    <button
                                        className="btn w-100 rounded-pill text-white"
                                        style={{ background: 'var(--danger-red)' }}
                                        onClick={handleDelete}
                                        disabled={deleting || !password}
                                    >
                                        {deleting ? t('Borrando…', 'Deleting…') : t('Borrar permanentemente', 'Delete permanently')}
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