import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import { accionLabel, type AuditoriaItem } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import './admin.css';
import { locale, t } from '../../i18n';

export default function AdminAuditoria() {
    const [params, setParams] = useSearchParams();
    const idPropietario = params.get('propietario');

    const [items, setItems] = useState<AuditoriaItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const { notifyError } = useNotice();

    useEffect(() => {
        setLoading(true);
        adminService
            .listarAuditoria(idPropietario ? Number(idPropietario) : undefined)
            .then((r) => {
                setItems(r.resultados);
                setTotal(r.total);
            })
            .catch((e) => notifyError(getApiErrorMessage(e, t('No se pudo cargar la auditoría.', "Couldn't load the audit log."))))
            .finally(() => setLoading(false));
    }, [idPropietario]);

    return (
        <DashboardLayout activeItem="admin-auditoria" topBarLabel={t('Panel Admin', 'Admin Panel')} variant="admin">
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">{t('Auditoría', 'Audit Log')}</h2>
                    <p className="text-muted m-0">
                        {t('Cada acción admin queda aquí: quién, sobre qué cuenta, qué hizo y por qué. Total:', 'Every admin action is recorded here: who, on which account, what they did and why. Total:')}{' '}
                        {total}
                    </p>
                </div>
                {idPropietario && (
                    <button className="btn btn-outline-secondary btn-sm rounded-pill" onClick={() => setParams({})}>
                        <i className="fas fa-xmark me-2" /> {t('Quitar filtro (propietario', 'Clear filter (owner')} #{idPropietario})
                    </button>
                )}
            </div>

            <div className="admin-card p-0">
                <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">{t('Acción', 'Action')}</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">{t('Motivo', 'Reason')}</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">{t('Propietario afectado', 'Affected owner')}</th>
                                <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">{t('Fecha', 'Date')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={4} className="text-center text-muted py-5">{t('Cargando…', 'Loading…')}</td></tr>
                            )}
                            {!loading && items.length === 0 && (
                                <tr><td colSpan={4} className="text-center text-muted py-5">{t('Sin registros de auditoría todavía.', 'No audit records yet.')}</td></tr>
                            )}
                            {!loading &&
                                items.map((it) => (
                                    <tr key={it.id}>
                                        <td className="ps-4 fw-bold small">{accionLabel(it.accion)}</td>
                                        <td className="small">{it.motivo}</td>
                                        <td className="small">
                                            {it.id_propietario_afectado ? (
                                                <Link to={`/admin/propietarios/${it.id_propietario_afectado}`}>
                                                    #{it.id_propietario_afectado}
                                                </Link>
                                            ) : (
                                                '—'
                                            )}
                                        </td>
                                        <td className="pe-4 text-end small text-muted">{new Date(it.creado_en).toLocaleString(locale())}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </DashboardLayout>
    );
}
