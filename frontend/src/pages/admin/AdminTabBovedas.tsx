import { useEffect, useState } from 'react';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import { categoriaLabel, type BovedaResponse } from '../../types/bovedas.types';
import { locale, t } from '../../i18n';
import { getApiErrorMessage } from '../../utils/errors';

interface Props {
    idPropietario: number;
}

const estadoLabel = (e: string): string =>
    ({
        borrador: t('Borrador', 'Draft'),
        activa: t('Activa', 'Active'),
        en_recuperacion: t('En recuperación', 'In recovery'),
        expirada: t('Expirada', 'Expired'),
    })[e] ?? e;

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
                notifyError(getApiErrorMessage(e, t('No se pudo cargar las bóvedas.', "Couldn't load the vaults.")));
            })
            .finally(() => setLoading(false));
    }, [idPropietario]);

    if (loading) return <p className="text-muted">{t('Cargando…', 'Loading…')}</p>;
    if (loadFailed) return null;

    return (
        <div>
            <p className="text-muted small mb-3">
                {t('Solo metadatos: nunca el contenido cifrado de los activos, ni la llave, ni los fragmentos.', 'Metadata only: never the encrypted asset contents, the key or the shares.')}
            </p>
            {bovedas.length === 0 ? (
                <div className="admin-card text-center text-muted py-5">
                    <i className="fas fa-vault fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }} />
                    {t('Este propietario aún no tiene bóvedas.', "This owner doesn't have any vaults yet.")}
                </div>
            ) : (
                <div className="admin-card p-0">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead style={{ background: '#f8fafc' }}>
                                <tr>
                                    <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">{t('Bóveda', 'Vault')}</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">{t('Estado', 'Status')}</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">{t('Umbral', 'Threshold')}</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">{t('Custodios vinculados', 'Linked custodians')}</th>
                                    <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">{t('Creada', 'Created')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bovedas.map((b) => (
                                    <tr key={b.id}>
                                        <td className="ps-4">
                                            <div className="fw-bold">{b.nombre}</div>
                                            <div className="text-muted small">{b.categoria ? categoriaLabel(b.categoria) : t('Sin categoría', 'No category')} · {b.pid}</div>
                                        </td>
                                        <td>
                                            <span className="admin-badge" style={{ background: '#e2e8f0', color: '#334155' }}>
                                                {estadoLabel(b.estado)}
                                            </span>
                                        </td>
                                        <td>
                                            {b.umbral_k ?? '—'} {t('de', 'of')} {b.total_fragmentos_n ?? '—'}
                                        </td>
                                        <td>{b.custodios_vinculados}</td>
                                        <td className="pe-4 text-end small text-muted">
                                            {b.created_at ? new Date(b.created_at).toLocaleDateString(locale()) : '—'}
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
