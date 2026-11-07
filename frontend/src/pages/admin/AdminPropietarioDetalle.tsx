import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import { ESTADO_BADGE_DEFAULT, ESTADO_DMS_LABELS, type PropietarioDetalle } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import AdminTabResumen from './AdminTabResumen';
import AdminTabDms from './AdminTabDms';
import AdminTabCustodios from './AdminTabCustodios';
import AdminTabBovedas from './AdminTabBovedas';
import AdminTabSuscripcion from './AdminTabSuscripcion';
import './admin.css';

type Tab = 'resumen' | 'dms' | 'custodios' | 'bovedas' | 'suscripcion';

const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'resumen', label: 'Resumen', icon: 'fa-id-card' },
    { key: 'dms', label: 'Interruptor de Hombre Muerto', icon: 'fa-heart-pulse' },
    { key: 'custodios', label: 'Custodios', icon: 'fa-users-cog' },
    { key: 'bovedas', label: 'Bóvedas', icon: 'fa-vault' },
    { key: 'suscripcion', label: 'Suscripción', icon: 'fa-credit-card' },
];

export default function AdminPropietarioDetalle() {
    const { id } = useParams<{ id: string }>();
    const idPropietario = Number(id);

    const [detalle, setDetalle] = useState<PropietarioDetalle | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>('resumen');
    const { notifyError } = useNotice();

    const cargarDetalle = () => {
        setLoading(true);
        adminService
            .detallePropietario(idPropietario)
            .then(setDetalle)
            .catch((e) => notifyError(getApiErrorMessage(e, 'No se pudo cargar ese propietario.')))
            .finally(() => setLoading(false));
    };

    useEffect(cargarDetalle, [idPropietario]);

    const estado = ESTADO_DMS_LABELS[detalle?.status_dms ?? ''] ?? ESTADO_BADGE_DEFAULT;

    return (
        <DashboardLayout activeItem="admin-propietarios" topBarLabel="Panel Admin" backTo="/admin" variant="admin">
            {loading && <p className="text-muted">Cargando…</p>}

            {detalle && (
                <>
                    <div className="admin-detail-header mb-4 d-flex justify-content-between align-items-start flex-wrap gap-3">
                        <div>
                            <h2 className="fw-bold mb-1">{detalle.nombre}</h2>
                            <p className="text-muted m-0">
                                @{detalle.username} · {detalle.correo} · ID #{detalle.id}
                            </p>
                        </div>
                        <div className="text-end">
                            <span className="admin-badge d-block mb-2" style={{ background: estado.bg, color: estado.color, fontSize: '0.8rem' }}>
                                {estado.label}
                            </span>
                            <Link to={`/admin/auditoria?propietario=${detalle.id}`} className="small">
                                Ver auditoría de esta cuenta
                            </Link>
                        </div>
                    </div>

                    <ul className="nav admin-tabs mb-4 flex-wrap">
                        {TABS.map((t) => (
                            <li className="nav-item" key={t.key}>
                                <button
                                    type="button"
                                    className={`nav-link ${tab === t.key ? 'active' : ''}`}
                                    onClick={() => setTab(t.key)}
                                >
                                    <i className={`fas ${t.icon} me-2`} /> {t.label}
                                </button>
                            </li>
                        ))}
                    </ul>

                    {tab === 'resumen' && <AdminTabResumen idPropietario={idPropietario} detalle={detalle} onCambio={cargarDetalle} />}
                    {tab === 'dms' && <AdminTabDms idPropietario={idPropietario} />}
                    {tab === 'custodios' && <AdminTabCustodios idPropietario={idPropietario} />}
                    {tab === 'bovedas' && <AdminTabBovedas idPropietario={idPropietario} />}
                    {tab === 'suscripcion' && <AdminTabSuscripcion idPropietario={idPropietario} onCambio={cargarDetalle} />}
                </>
            )}
        </DashboardLayout>
    );
}
