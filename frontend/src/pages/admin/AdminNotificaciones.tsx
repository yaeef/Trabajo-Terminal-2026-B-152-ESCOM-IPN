import { useEffect, useState } from 'react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import type { CanalNotificacion, EstadoNotificacion, NotificacionItem } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import AdminMotivoModal from './AdminMotivoModal';
import './admin.css';

const ESTADO_BADGE: Record<EstadoNotificacion, { bg: string; color: string; label: string }> = {
    pendiente: { bg: '#fef3c7', color: '#b45309', label: 'Pendiente' },
    enviada: { bg: '#dcfce7', color: '#15803d', label: 'Enviada' },
    fallida: { bg: '#fee2e2', color: '#b91c1c', label: 'Fallida' },
};

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
            .catch((e) => notifyError(getApiErrorMessage(e, 'No se pudo cargar la cola de notificaciones.')))
            .finally(() => setLoading(false));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cargar, [estado, canal]);

    const reintentar = async (motivo: string) => {
        try {
            const r = await adminService.reintentarNotificaciones({ motivo });
            setShowReintentar(false);
            notifySuccess(`Se entregaron ${r.enviadas} notificación(es) pendiente(s).`);
            cargar();
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo reintentar el envío.'));
            throw e;
        }
    };

    return (
        <DashboardLayout activeItem="admin-notificaciones" topBarLabel="Panel Admin" variant="admin">
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">Cola de notificaciones</h2>
                    <p className="text-muted m-0">Correo y Telegram salientes (avisos del DMS, verificaciones, etc.). Total: {total}</p>
                </div>
                <button className="btn btn-ipn" onClick={() => setShowReintentar(true)}>
                    <i className="fas fa-rotate me-2" /> Reintentar pendientes
                </button>
            </div>

            <div className="d-flex gap-2 mb-4">
                <select className="form-select shadow-none" style={{ maxWidth: 200 }} value={estado} onChange={(e) => setEstado(e.target.value as EstadoNotificacion | '')}>
                    <option value="">Todos los estados</option>
                    <option value="pendiente">Pendiente</option>
                    <option value="enviada">Enviada</option>
                    <option value="fallida">Fallida</option>
                </select>
                <select className="form-select shadow-none" style={{ maxWidth: 200 }} value={canal} onChange={(e) => setCanal(e.target.value as CanalNotificacion | '')}>
                    <option value="">Todos los canales</option>
                    <option value="correo">Correo</option>
                    <option value="telegram">Telegram</option>
                </select>
            </div>

            <div className="admin-card p-0">
                <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">Destino</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Plantilla</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Estado</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Intentos</th>
                                <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">Creada</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={5} className="text-center text-muted py-5">Cargando…</td></tr>
                            )}
                            {!loading && notificaciones.length === 0 && (
                                <tr><td colSpan={5} className="text-center text-muted py-5">No hay notificaciones con esos filtros.</td></tr>
                            )}
                            {!loading &&
                                notificaciones.map((n) => {
                                    const badge = ESTADO_BADGE[n.estado];
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
                                            <td className="pe-4 text-end small text-muted">{new Date(n.creada_en).toLocaleString('es-MX')}</td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>

            {showReintentar && (
                <AdminMotivoModal
                    title="Reintentar notificaciones pendientes"
                    description="Entrega de inmediato las notificaciones 'pendiente' cuyo tiempo de espera ya venció, sin esperar el reintento automático."
                    confirmLabel="Reintentar"
                    onConfirm={reintentar}
                    onClose={() => setShowReintentar(false)}
                />
            )}
        </DashboardLayout>
    );
}
