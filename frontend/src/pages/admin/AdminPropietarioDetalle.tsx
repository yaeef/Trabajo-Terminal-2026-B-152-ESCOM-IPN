import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import { estadoDmsBadge, type PropietarioDetalle } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import AdminTabResumen from './AdminTabResumen';
import AdminTabDms from './AdminTabDms';
import AdminTabCustodios from './AdminTabCustodios';
import AdminTabBovedas from './AdminTabBovedas';
import AdminTabSuscripcion from './AdminTabSuscripcion';
import './admin.css';
import { t } from '../../i18n';

type Tab = 'resumen' | 'dms' | 'custodios' | 'bovedas' | 'suscripcion';

const tabs = (): { key: Tab; label: string; icon: string }[] => [
    { key: 'resumen', label: t('Resumen', 'Summary'), icon: 'fa-id-card' },
    { key: 'dms', label: t('Interruptor de Hombre Muerto', "Dead Man's Switch"), icon: 'fa-heart-pulse' },
    { key: 'custodios', label: t('Custodios', 'Custodians'), icon: 'fa-users-cog' },
    { key: 'bovedas', label: t('Bóvedas', 'Vaults'), icon: 'fa-vault' },
    { key: 'suscripcion', label: t('Suscripción', 'Subscription'), icon: 'fa-credit-card' },
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
            .catch((e) => notifyError(getApiErrorMessage(e, t('No se pudo cargar ese propietario.', "Couldn't load that owner."))))
            .finally(() => setLoading(false));
    };

    useEffect(cargarDetalle, [idPropietario]);

    const estado = estadoDmsBadge(detalle?.status_dms);

    return (
        <DashboardLayout activeItem="admin-propietarios" topBarLabel={t('Panel Admin', 'Admin Panel')} backTo="/admin" variant="admin">
            {loading && <p className="text-muted">{t('Cargando…', 'Loading…')}</p>}

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
                                {t('Ver auditoría de esta cuenta', "View this account's audit log")}
                            </Link>
                        </div>
                    </div>

                    <ul className="nav admin-tabs mb-4 flex-wrap">
                        {tabs().map((tb) => (
                            <li className="nav-item" key={tb.key}>
                                <button
                                    type="button"
                                    className={`nav-link ${tab === tb.key ? 'active' : ''}`}
                                    onClick={() => setTab(tb.key)}
                                >
                                    <i className={`fas ${tb.icon} me-2`} /> {tb.label}
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
