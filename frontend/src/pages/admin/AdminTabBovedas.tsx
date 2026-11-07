import { useEffect, useState } from 'react';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import type { BovedaResponse } from '../../types/bovedas.types';
import { getApiErrorMessage } from '../../utils/errors';

interface Props {
    idPropietario: number;
}

const ESTADO_LABEL: Record<string, string> = {
    borrador: 'Borrador',
    activa: 'Activa',
    en_recuperacion: 'En recuperación',
    expirada: 'Expirada',
};

export default function AdminTabBovedas({ idPropietario }: Props) {
    const [bovedas, setBovedas] = useState<BovedaResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const { notifyError } = useNotice();

    useEffect(() => {
        setLoading(true);
        adminService
            .bovedasDePropietario(idPropietario)
            .then(setBovedas)
            .catch((e) => {
                setLoadFailed(true);
                notifyError(getApiErrorMessage(e, 'No se pudo cargar las bóvedas.'));
            })
            .finally(() => setLoading(false));
    }, [idPropietario]);

    if (loading) return <p className="text-muted">Cargando…</p>;
    if (loadFailed) return null;

    return (
        <div>
            <p className="text-muted small mb-3">
                Solo metadatos: nunca el contenido cifrado de los activos, ni la llave, ni los fragmentos.
            </p>
            {bovedas.length === 0 ? (
                <div className="admin-card text-center text-muted py-5">
                    <i className="fas fa-vault fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }} />
                    Este propietario aún no tiene bóvedas.
                </div>
            ) : (
                <div className="admin-card p-0">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead style={{ background: '#f8fafc' }}>
                                <tr>
                                    <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">Bóveda</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Estado</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Umbral</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Custodios vinculados</th>
                                    <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">Creada</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bovedas.map((b) => (
                                    <tr key={b.id}>
                                        <td className="ps-4">
                                            <div className="fw-bold">{b.nombre}</div>
                                            <div className="text-muted small">{b.categoria ?? 'Sin categoría'} · {b.pid}</div>
                                        </td>
                                        <td>
                                            <span className="admin-badge" style={{ background: '#e2e8f0', color: '#334155' }}>
                                                {ESTADO_LABEL[b.estado] ?? b.estado}
                                            </span>
                                        </td>
                                        <td>{b.umbral_k ?? '—'} de {b.total_fragmentos_n ?? '—'}</td>
                                        <td>{b.custodios_vinculados}</td>
                                        <td className="pe-4 text-end small text-muted">
                                            {b.created_at ? new Date(b.created_at).toLocaleDateString('es-MX') : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
