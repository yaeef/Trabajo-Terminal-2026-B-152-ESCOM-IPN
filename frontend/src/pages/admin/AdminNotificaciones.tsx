import { useEffect, useState } from 'react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import type { CanalNotificacion, EstadoNotificacion, NotificacionItem } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import AdminMotivoModal from './AdminMotivoModal';
import './admin.css';
import { locale, t } from '../../i18n';

const estadoBadge = (e: EstadoNotificacion): { bg: string; color: string; label: string } =>
    ({
        pendiente: { bg: '#fef3c7', color: '#b45309', label: t('Pendiente', 'Pending') },
        enviada: { bg: '#dcfce7', color: '#15803d', label: t('Enviada', 'Sent') },
        fallida: { bg: '#fee2e2', color: '#b91c1c', label: t('Fallida', 'Failed') },
    })[e];

export default function AdminNotificaciones() {
    const [notificaciones, setNotificaciones] = useState<NotificacionItem[]>([]);
    const [total, setTotal] = useState(0);
    const [estado, setEstado] = useState<EstadoNotificacion | ''>('pendiente');
    const [canal, setCanal] = useState<CanalNotificacion | ''>('');
    const [loading, setLoading] = useState(true);
    const { notifyError, notifySuccess } = useNotice();
    const [showReintentar, setShowReintentar] = useState(false);

    const cargar = () => {
        setLoading(true);
        adminService
            .listarNotificaciones({ estado: estado || undefined, canal: canal || undefined })
            .then((r) => {
                setNotificaciones(r.resultados);
                setTotal(r.total);
            })
            .catch((e) => notifyError(getApiErrorMessage(e, t('No se pudo cargar la cola de notificaciones.', "Couldn't load the notification queue."))))
            .finally(() => setLoading(false));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cargar, [estado, canal]);

    const reintentar = async (motivo: string) => {
        try {
            const r = await adminService.reintentarNotificaciones({ motivo });
            setShowReintentar(false);
            notifySuccess(t(`Se entregaron ${r.enviadas} notificación(es) pendiente(s).`, `${r.enviadas} pending notification(s) delivered.`));
            cargar();
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo reintentar el envío.', "Couldn't retry sending.")));
            throw e;
        }
    };

    return (
        <DashboardLayout activeItem="admin-notificaciones" topBarLabel={t('Panel Admin', 'Admin Panel')} variant="admin">
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">{t('Cola de notificaciones', 'Notification queue')}</h2>
                    <p className="text-muted m-0">{t('Correo y Telegram salientes (avisos del DMS, verificaciones, etc.). Total:', 'Outgoing email and Telegram (DMS notices, verifications, etc.). Total:')}{' '}
                        {total}</p>
                </div>
                <button className="btn btn-ipn" onClick={() => setShowReintentar(true)}>
                    <i className="fas fa-rotate me-2" /> {t('Reintentar pendientes', 'Retry pending')}
                </button>
            </div>

            <div className="d-flex gap-2 mb-4">
                <select className="form-select shadow-none" style={{ maxWidth: 200 }} value={estado} onChange={(e) => setEstado(e.target.value as EstadoNotificacion | '')}>
                    <option value="">{t('Todos los estados', 'All statuses')}</option>
                    <option value="pendiente">{t('Pendiente', 'Pending')}</option>
                    <option value="enviada">{t('Enviada', 'Sent')}</option>
                    <option value="fallida">{t('Fallida', 'Failed')}</option>
                </select>
                <select className="form-select shadow-none" style={{ maxWidth: 200 }} value={canal} onChange={(e) => setCanal(e.target.value as CanalNotificacion | '')}>
                    <option value="">{t('Todos los canales', 'All channels')}</option>
                    <option value="correo">{t('Correo', 'Email')}</option>
                    <option value="telegram">Telegram</option>
                </select>
            </div>

            <div className="admin-card p-0">
                <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">{t('Destino', 'Recipient')}</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">{t('Plantilla', 'Template')}</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">{t('Estado', 'Status')}</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">{t('Intentos', 'Attempts')}</th>
                                <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">{t('Creada', 'Created')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={5} className="text-center text-muted py-5">{t('Cargando…', 'Loading…')}</td></tr>
                            )}
                            {!loading && notificaciones.length === 0 && (
                                <tr><td colSpan={5} className="text-center text-muted py-5">{t('No hay notificaciones con esos filtros.', 'No notifications match those filters.')}</td></tr>
                            )}
                            {!loading &&
                                notificaciones.map((n) => {
                                    const badge = estadoBadge(n.estado);
                                    return (
                                        <tr key={n.id}>
                                            <td className="ps-4">
                                                <div className="fw-bold small">
                                                    <i className={`fas ${n.canal === 'telegram' ? 'fa-paper-plane' : 'fa-envelope'} me-2 text-muted`} />
                                                    {n.destino}
                                                </div>
                                                {n.ultimo_error && <div className="text-muted small">{n.ultimo_error}</div>}
                                            </td>
                                            <td className="small">{n.plantilla}</td>
                                            <td>
                                                <span className="admin-badge" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
                                            </td>
                                            <td>{n.intentos}</td>
                                            <td className="pe-4 text-end small text-muted">{new Date(n.creada_en).toLocaleString(locale())}</td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>

            {showReintentar && (
                <AdminMotivoModal
                    title={t('Reintentar notificaciones pendientes', 'Retry pending notifications')}
                    description={t("Entrega de inmediato las notificaciones 'pendiente' cuyo tiempo de espera ya venció, sin esperar el reintento automático.", "Immediately delivers the 'pending' notifications whose wait time has expired, without waiting for the automatic retry.")}
                    confirmLabel={t('Reintentar', 'Retry')}
                    onConfirm={reintentar}
                    onClose={() => setShowReintentar(false)}
                />
            )}
        </DashboardLayout>
    );
}
