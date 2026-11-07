import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import VerificationStatusWidget from '../components/VerificationStatusWidget';
import { dashboardService } from '../services/dashboard.service';
import StorageMeter from '../components/StorageMeter';
import type { DashboardResponse } from '../types/dashboard.types';
import type { ProtocoloVidaResponse } from '../types/dms.types';
import { useAuth } from '../store/AuthContext';
import './Dashboard.css';

const DEFAULT_PERIODICIDAD_DIAS = 60;
const CHECKIN_MODAL_DURATION_MS = 10000;

const BADGE = {
    protegida: { label: 'Protegida', icon: 'fa-check-circle', cls: 'text-success border-success' },
    incompleta: { label: 'Incompleta', icon: 'fa-exclamation-triangle', cls: 'text-warning border-warning' },
    borrador: { label: 'Borrador', icon: 'fa-pen-ruler', cls: 'text-secondary border-secondary' },
} as const;

export default function Dashboard() {
    const { user } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const [data, setData] = useState<DashboardResponse | null>(null);
    const [loading, setLoading] = useState(true);

    const [showCheckinModal, setShowCheckinModal] = useState(false);
    const [checkinBarCollapsed, setCheckinBarCollapsed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        dashboardService
            .get()
            .then((d) => {
                if (!cancelled) setData(d);
            })
            .catch(() => {
                if (!cancelled) setData(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if ((location.state as { justLoggedIn?: boolean } | null)?.justLoggedIn) {
            setShowCheckinModal(true);
            navigate(location.pathname, { replace: true, state: {} });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!showCheckinModal) return;
        const collapseTimer = setTimeout(() => setCheckinBarCollapsed(true), 100);
        const hideTimer = setTimeout(() => setShowCheckinModal(false), CHECKIN_MODAL_DURATION_MS);
        return () => {
            clearTimeout(collapseTimer);
            clearTimeout(hideTimer);
        };
    }, [showCheckinModal]);

    const protocoloVida: ProtocoloVidaResponse | null = data
        ? {
              periodicidad_prueba: data.protocolo_vida.periodicidad_prueba,
              periodicidad_periodo_gracia: data.protocolo_vida.periodicidad_periodo_gracia,
              ultima_prueba: data.protocolo_vida.ultima_prueba,
              status_dms: data.protocolo_vida.status_dms,
          }
        : null;

    const diasProximoCheckin = protocoloVida?.periodicidad_prueba ?? DEFAULT_PERIODICIDAD_DIAS;

    return (
        <DashboardLayout activeItem="dashboard" topBarLabel="Área de trabajo">
            <div className="d-flex justify-content-between align-items-end mb-5 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">Bienvenido, {user?.nombre ?? user?.username}.</h2>
                    <p className="text-muted m-0">Gestiona tus activos y configura tus Bóvedas.</p>
                </div>
                <VerificationStatusWidget protocoloVida={protocoloVida} loading={loading} />
            </div>

            {/* Stats */}
            <div className="row g-4 mb-5">
                <div className="col-md-4">
                    <div className="stat-card h-100">
                        <div className="d-flex justify-content-between align-items-start h-100">
                            <div>
                                <p className="verif-label mb-2">Bóvedas Totales</p>
                                <h3 className="fw-bold m-0">{loading ? '—' : data?.bovedas_total ?? 0}</h3>
                                {!loading && data && (
                                    <p className="m-0 text-muted" style={{ fontSize: '0.75rem' }}>
                                        {data.bovedas_protegidas} protegida{data.bovedas_protegidas === 1 ? '' : 's'}
                                    </p>
                                )}
                            </div>
                            <div className="p-2 bg-light rounded-3 text-primary">
                                <i className="fas fa-boxes-stacked fa-lg"></i>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-md-4">
                    <div className="stat-card h-100">
                        <div className="d-flex justify-content-between align-items-start h-100">
                            <div>
                                <p className="verif-label mb-2">Custodios Registrados</p>
                                <h3 className="fw-bold m-0">{loading ? '—' : data?.custodios_total ?? 0}</h3>
                            </div>
                            <div className="p-2 bg-light rounded-3" style={{ color: 'var(--ipn-maroon)' }}>
                                <i className="fas fa-users-viewfinder fa-lg"></i>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-md-4">
                    <div className="stat-card h-100 d-flex flex-column justify-content-center">
                        <StorageMeter
                            label="Espacio Usado"
                            usado={data?.usado_bytes ?? 0}
                            cuota={data?.cuota_bytes ?? 0}
                            note={loading ? 'Cargando…' : undefined}
                        />
                    </div>
                </div>
            </div>

            {/* Inventario de Bóvedas */}
            <div className="vault-card p-4">
                <div className="d-flex justify-content-between align-items-center mb-4 px-2">
                    <h5 className="fw-bold m-0">Inventario de Bóvedas Digitales</h5>
                    <button className="btn btn-ipn btn-sm" onClick={() => navigate('/bovedas/nueva')}>
                        <i className="fas fa-plus-circle me-2"></i> Nueva
                    </button>
                </div>

                {loading ? (
                    <p className="text-muted px-2">Cargando…</p>
                ) : !data || data.bovedas.length === 0 ? (
                    <div className="text-center text-muted py-5">
                        <i className="fas fa-vault fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }}></i>
                        Aún no tienes bóvedas.{' '}
                        <button className="btn btn-link p-0 align-baseline" onClick={() => navigate('/bovedas/nueva')}>
                            Crea la primera
                        </button>
                        .
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table className="table table-hover align-middle">
                            <thead className="text-muted small">
                                <tr>
                                    <th className="border-0 ps-3">NOMBRE</th>
                                    <th className="border-0">UMBRAL (k/n)</th>
                                    <th className="border-0 text-center">ESTADO</th>
                                    <th className="border-0">CUSTODIOS</th>
                                    <th className="border-0 text-end pe-3">ACCIONES</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.bovedas.map((b) => {
                                    const meta = BADGE[b.badge];
                                    return (
                                        <tr key={b.id}>
                                            <td className="ps-3">
                                                <div className="d-flex align-items-center">
                                                    <div className="p-2 bg-light rounded-3 me-3 text-primary">
                                                        <i className="fas fa-vault"></i>
                                                    </div>
                                                    <div>
                                                        <p className="m-0 fw-bold">{b.nombre}</p>
                                                        <small className="text-muted">{b.categoria || 'Sin categoría'}</small>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <span className="fw-bold">
                                                    {b.umbral_k ?? '–'} / {b.total_fragmentos_n ?? '–'}
                                                </span>
                                            </td>
                                            <td className="text-center">
                                                <span
                                                    className={`badge bg-light border badge-status ${meta.cls}`}
                                                    style={{ minWidth: 100 }}
                                                >
                                                    <i className={`fas ${meta.icon} me-1`}></i> {meta.label}
                                                </span>
                                            </td>
                                            <td className="text-muted small">
                                                {b.total_fragmentos_n
                                                    ? `${b.custodios_vinculados} / ${b.total_fragmentos_n}`
                                                    : '—'}
                                            </td>
                                            <td className="text-end pe-3">
                                                <button
                                                    className="btn btn-sm btn-outline-primary rounded-pill px-3 fw-bold"
                                                    onClick={() =>
                                                        navigate(
                                                            b.badge === 'protegida'
                                                                ? `/bovedas/${b.id}`
                                                                : `/bovedas/nueva?resume=${b.id}`,
                                                        )
                                                    }
                                                >
                                                    {b.badge === 'protegida' ? 'Gestionar' : 'Configurar'}{' '}
                                                    <i className="fas fa-arrow-right ms-1"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {showCheckinModal && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg text-center">
                            <div className="modal-header-gradient"></div>
                            <button
                                type="button"
                                className="btn-close-checkin"
                                aria-label="Cerrar"
                                onClick={() => setShowCheckinModal(false)}
                            >
                                <i className="fas fa-times"></i>
                            </button>
                            <div className="modal-body p-5">
                                <div className="success-icon-circle animate__animated animate__bounceIn">
                                    <i className="fas fa-check fa-3x"></i>
                                </div>
                                <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                    Check-in Realizado
                                </h3>
                                <p className="text-muted">
                                    Tu presencia ha sido validada en el sistema. El protocolo de recuperación se ha
                                    postergado exitosamente.
                                </p>
                                <div className="bg-light p-3 rounded-4 mt-4">
                                    <p className="m-0 small fw-bold text-dark">Próximo Check-in obligatorio en:</p>
                                    <p className="m-0 h4 fw-bold" style={{ color: 'var(--ipn-maroon)' }}>
                                        +{diasProximoCheckin} días
                                    </p>
                                </div>
                            </div>
                            <div className="progress-timer" style={{ width: checkinBarCollapsed ? '0%' : '100%' }}></div>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
