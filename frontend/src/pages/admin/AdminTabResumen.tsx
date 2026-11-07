import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StorageMeter from '../../components/StorageMeter';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import type { PropietarioDetalle } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import AdminMotivoModal from './AdminMotivoModal';

interface Props {
    idPropietario: number;
    detalle: PropietarioDetalle;
    onCambio: () => void;
}

export default function AdminTabResumen({ idPropietario, detalle, onCambio }: Props) {
    const navigate = useNavigate();
    const { notifyError, notifySuccess } = useNotice();
    const [showCancelar, setShowCancelar] = useState(false);
    const [showPurgar, setShowPurgar] = useState(false);
    const [purgando, setPurgando] = useState(false);
    const [motivoPurga, setMotivoPurga] = useState('');
    const [passAdmin, setPassAdmin] = useState('');
    const [purgaErr, setPurgaErr] = useState('');

    const cancelarEliminacion = async (motivo: string) => {
        try {
            await adminService.cancelarEliminacion(idPropietario, { motivo });
            setShowCancelar(false);
            notifySuccess('Se canceló la eliminación de esta cuenta.');
            onCambio();
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo cancelar la eliminación.'));
            throw e;
        }
    };

    const purgarAhora = async () => {
        if (motivoPurga.trim().length < 5) {
            setPurgaErr('Escribe un motivo de al menos 5 caracteres.');
            return;
        }
        if (!passAdmin) {
            setPurgaErr('Confirma con tu contraseña de administrador.');
            return;
        }
        setPurgando(true);
        setPurgaErr('');
        try {
            await adminService.purgarAhora(idPropietario, { motivo: motivoPurga.trim(), contrasena_admin: passAdmin });
            navigate('/admin', { state: { notice: `La cuenta de ${detalle.nombre} fue purgada de inmediato.` } });
        } catch (e) {
            setPurgaErr(getApiErrorMessage(e, 'No se pudo purgar la cuenta.'));
        } finally {
            setPurgando(false);
        }
    };

    const bloqueada = detalle.status_dms === 'liberado' || detalle.status_dms === 'eliminado';

    return (
        <div className="row g-4">
            <div className="col-md-4">
                <div className="stat-card h-100">
                    <p className="verif-label mb-2">Bóvedas</p>
                    <h3 className="fw-bold m-0" style={{ color: 'var(--escom-blue)' }}>{detalle.bovedas_total}</h3>
                </div>
            </div>
            <div className="col-md-4">
                <div className="stat-card h-100" style={{ borderTopColor: 'var(--ipn-maroon)' }}>
                    <p className="verif-label mb-2">Custodios</p>
                    <h3 className="fw-bold m-0" style={{ color: 'var(--ipn-maroon)' }}>{detalle.custodios_total}</h3>
                </div>
            </div>
            <div className="col-md-4">
                <div className="stat-card h-100">
                    <p className="verif-label mb-2">Plan</p>
                    <h3 className="fw-bold m-0">{detalle.plan_nombre}</h3>
                </div>
            </div>

            <div className="col-md-6">
                <div className="admin-card p-4 h-100">
                    <StorageMeter usado={detalle.usado_bytes} cuota={detalle.cuota_bytes} />
                </div>
            </div>

            <div className="col-md-6">
                <div className="admin-card p-4 h-100">
                    <h5 className="fw-bold mb-3">Cuenta</h5>

                    {detalle.eliminacion_solicitada_en ? (
                        <div className="mb-3">
                            <p className="small text-muted mb-2">
                                Eliminación solicitada el {new Date(detalle.eliminacion_solicitada_en).toLocaleString('es-MX')}.
                                {detalle.eliminacion_purga_en && (
                                    <> Se purgará el {new Date(detalle.eliminacion_purga_en).toLocaleDateString('es-MX')} si nadie la cancela.</>
                                )}
                            </p>
                            <button className="btn btn-ipn btn-sm" onClick={() => setShowCancelar(true)}>
                                Cancelar eliminación
                            </button>
                        </div>
                    ) : (
                        <p className="small text-muted mb-3">No hay ninguna solicitud de eliminación pendiente.</p>
                    )}

                    <hr />
                    <p className="small text-muted mb-2">
                        Purga irreversible sin periodo de gracia — solo para casos de soporte/legales (p. ej. una solicitud ARCO urgente).
                    </p>
                    <button
                        className="btn btn-sm rounded-pill text-white"
                        style={{ background: 'var(--danger-red)' }}
                        onClick={() => setShowPurgar(true)}
                        disabled={bloqueada}
                        title={bloqueada ? 'Esta cuenta ya está liberada o eliminada.' : undefined}
                    >
                        <i className="fas fa-user-slash me-2" /> Purgar cuenta ahora
                    </button>
                </div>
            </div>

            {showCancelar && (
                <AdminMotivoModal
                    title="Cancelar eliminación de cuenta"
                    description="El propietario vuelve a tener acceso normal de inmediato."
                    confirmLabel="Cancelar eliminación"
                    onConfirm={cancelarEliminacion}
                    onClose={() => setShowCancelar(false)}
                />
            )}

            {showPurgar && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" style={{ background: 'var(--danger-red)' }} />
                            <div className="modal-body p-5">
                                <h4 className="fw-bold mb-1">Purgar cuenta ahora</h4>
                                <p className="text-muted small mb-4">
                                    Acción irreversible: borra bóvedas, activos y directorio de custodios, y anonimiza la
                                    identidad de <strong>{detalle.nombre}</strong>. Confírmalo con tu propia contraseña de
                                    administrador.
                                </p>
                                {purgaErr && <div className="alert alert-danger py-2 small">{purgaErr}</div>}
                                <label className="form-label-b d-block">Motivo (queda en la auditoría)</label>
                                <textarea
                                    className="form-control shadow-none mb-3"
                                    rows={2}
                                    value={motivoPurga}
                                    onChange={(e) => setMotivoPurga(e.target.value)}
                                    placeholder="Ej: solicitud ARCO urgente vía soporte."
                                />
                                <label className="form-label-b d-block">Tu contraseña de administrador</label>
                                <input
                                    type="password"
                                    className="form-control shadow-none mb-4"
                                    value={passAdmin}
                                    onChange={(e) => setPassAdmin(e.target.value)}
                                />
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={() => setShowPurgar(false)} disabled={purgando}>
                                        Cancelar
                                    </button>
                                    <button
                                        className="btn w-100 rounded-pill text-white"
                                        style={{ background: 'var(--danger-red)' }}
                                        onClick={purgarAhora}
                                        disabled={purgando}
                                    >
                                        {purgando ? 'Purgando…' : 'Purgar ahora'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
