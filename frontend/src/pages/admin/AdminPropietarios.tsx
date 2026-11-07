import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import { ESTADO_BADGE_DEFAULT, ESTADO_DMS_LABELS, type PropietarioListaItem } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import './admin.css';

const TAM_PAGINA = 20;

export default function AdminPropietarios() {
    const navigate = useNavigate();
    const location = useLocation();

    const [q, setQ] = useState('');
    const [resultados, setResultados] = useState<PropietarioListaItem[]>([]);
    const [total, setTotal] = useState(0);
    const [pagina, setPagina] = useState(1);
    const [loading, setLoading] = useState(true);
    const { notifyError, notifySuccess } = useNotice();

    const totalPages = Math.max(1, Math.ceil(total / TAM_PAGINA));

    const load = (pág: number) => {
        setLoading(true);
        adminService
            .buscarPropietarios(q, pág, TAM_PAGINA)
            .then((r) => {
                setResultados(r.resultados);
                setTotal(r.total);
                setPagina(r.pagina);
            })
            .catch((e) => notifyError(getApiErrorMessage(e, 'No se pudo cargar la lista de propietarios.')))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load(1);
        const notice = (location.state as { notice?: string } | null)?.notice;
        if (notice) notifySuccess(notice);
        // Solo al montar: la búsqueda se dispara explícitamente con el botón.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const buscar = (e: React.FormEvent) => {
        e.preventDefault();
        load(1);
    };

    return (
        <DashboardLayout activeItem="admin-propietarios" topBarLabel="Panel Admin" variant="admin">
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">Propietarios</h2>
                    <p className="text-muted m-0">
                        Busca una cuenta para ver su Interruptor de Hombre Muerto, custodios, bóvedas y suscripción.
                    </p>
                </div>
            </div>

            <form className="d-flex gap-2 mb-4" onSubmit={buscar}>
                <input
                    className="form-control shadow-none"
                    style={{ maxWidth: 420 }}
                    placeholder="Nombre, username o correo…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                />
                <button className="btn btn-ipn" type="submit" disabled={loading}>
                    <i className="fas fa-magnifying-glass me-2" /> Buscar
                </button>
            </form>

            <div className="admin-card">
                <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">Propietario</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Plan</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Estado DMS</th>
                                <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">Alta</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr>
                                    <td colSpan={4} className="text-center text-muted py-5">
                                        Cargando…
                                    </td>
                                </tr>
                            )}
                            {!loading && resultados.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="text-center text-muted py-5">
                                        <i className="fas fa-user-slash fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }} />
                                        No se encontraron propietarios.
                                    </td>
                                </tr>
                            )}
                            {!loading &&
                                resultados.map((p) => {
                                    const estado = ESTADO_DMS_LABELS[p.status_dms ?? ''] ?? ESTADO_BADGE_DEFAULT;
                                    return (
                                        <tr
                                            key={p.id}
                                            className="admin-row-clickable"
                                            onClick={() => navigate(`/admin/propietarios/${p.id}`)}
                                        >
                                            <td className="ps-4">
                                                <div className="fw-bold">{p.nombre}</div>
                                                <div className="text-muted small">
                                                    @{p.username} · {p.correo}
                                                </div>
                                                {p.eliminacion_solicitada_en && (
                                                    <span className="admin-badge mt-1 d-inline-block" style={{ background: '#fee2e2', color: '#b91c1c' }}>
                                                        Eliminación pendiente
                                                    </span>
                                                )}
                                            </td>
                                            <td>{p.plan_nombre}</td>
                                            <td>
                                                <span className="admin-badge" style={{ background: estado.bg, color: estado.color }}>
                                                    {estado.label}
                                                </span>
                                            </td>
                                            <td className="pe-4 text-end small text-muted">
                                                {p.created_at ? new Date(p.created_at).toLocaleDateString('es-MX') : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>

                {!loading && total > TAM_PAGINA && (
                    <div className="d-flex justify-content-between align-items-center px-4 py-3 border-top">
                        <span className="small text-muted">
                            Mostrando {(pagina - 1) * TAM_PAGINA + 1}–{Math.min(pagina * TAM_PAGINA, total)} de {total}
                        </span>
                        <div className="d-flex gap-2">
                            <button
                                type="button"
                                className="btn btn-light btn-sm rounded-pill px-3 border"
                                onClick={() => load(pagina - 1)}
                                disabled={pagina <= 1}
                            >
                                <i className="fas fa-chevron-left me-1" /> Anterior
                            </button>
                            <span className="small text-muted align-self-center px-2">
                                Página {pagina} de {totalPages}
                            </span>
                            <button
                                type="button"
                                className="btn btn-light btn-sm rounded-pill px-3 border"
                                onClick={() => load(pagina + 1)}
                                disabled={pagina >= totalPages}
                            >
                                Siguiente <i className="fas fa-chevron-right ms-1" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}
