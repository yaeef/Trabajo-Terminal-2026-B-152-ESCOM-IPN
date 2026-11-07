import { useEffect, useState } from 'react';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import type { CustodioResponse } from '../../types/custodios.types';
import { getApiErrorMessage } from '../../utils/errors';
import AdminMotivoModal from './AdminMotivoModal';

interface Props {
    idPropietario: number;
}

function VerifTag({ ok }: { ok: boolean }) {
    return <span className="admin-badge" style={ok ? { background: '#dcfce7', color: '#15803d' } : { background: '#fee2e2', color: '#b91c1c' }}>{ok ? 'Verificado' : 'No verificado'}</span>;
}

export default function AdminTabCustodios({ idPropietario }: Props) {
    const [custodios, setCustodios] = useState<CustodioResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const { notifyError, notifySuccess } = useNotice();
    const [objetivo, setObjetivo] = useState<CustodioResponse | null>(null);

    const cargar = () => {
        setLoading(true);
        adminService
            .custodiosDePropietario(idPropietario)
            .then(setCustodios)
            .catch((e) => notifyError(getApiErrorMessage(e, 'No se pudo cargar el directorio de custodios.')))
            .finally(() => setLoading(false));
    };
    useEffect(cargar, [idPropietario]);

    const reenviar = async (motivo: string) => {
        if (!objetivo) return;
        try {
            await adminService.reenviarVerificacionCustodio(idPropietario, objetivo.id, { motivo });
            setObjetivo(null);
            notifySuccess(`Se reenvió la verificación a ${objetivo.correo}.`);
            cargar();
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo reenviar la verificación.'));
            throw e;
        }
    };

    if (loading) return <p className="text-muted">Cargando…</p>;

    return (
        <div>
            {custodios.length === 0 ? (
                <div className="admin-card text-center text-muted py-5">
                    <i className="fas fa-users-slash fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }} />
                    Este propietario aún no registra custodios.
                </div>
            ) : (
                <div className="admin-card p-0">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead style={{ background: '#f8fafc' }}>
                                <tr>
                                    <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">Custodio</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Correo</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Telegram</th>
                                    <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {custodios.map((c) => (
                                    <tr key={c.id}>
                                        <td className="ps-4">
                                            <div className="fw-bold">{c.nombre_completo || c.nombre}</div>
                                            <div className="text-muted small">{c.parentesco} · ID #C-{c.id}</div>
                                        </td>
                                        <td>
                                            <div className="small mb-1">{c.correo}</div>
                                            <VerifTag ok={c.correo_verificado} />
                                        </td>
                                        <td>
                                            <VerifTag ok={c.telegram_verificado} />
                                        </td>
                                        <td className="pe-4 text-end">
                                            {!c.correo_verificado && (
                                                <button className="btn btn-sm btn-outline-secondary rounded-pill" onClick={() => setObjetivo(c)}>
                                                    Reenviar verificación
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {objetivo && (
                <AdminMotivoModal
                    title={`Reenviar verificación a ${objetivo.nombre_completo || objetivo.nombre}`}
                    description={`Se reenvía un enlace de verificación de correo a ${objetivo.correo}.`}
                    confirmLabel="Reenviar"
                    onConfirm={reenviar}
                    onClose={() => setObjetivo(null)}
                />
            )}
        </div>
    );
}
