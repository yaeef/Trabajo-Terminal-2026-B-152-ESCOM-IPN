import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StorageMeter from '../../components/StorageMeter';
import { adminService } from '../../services/admin.service';
import { useNotice } from '../../store/NoticeContext';
import type { PropietarioDetalle } from '../../types/admin.types';
import { getApiErrorMessage } from '../../utils/errors';
import AdminMotivoModal from './AdminMotivoModal';
import { getLang, locale, t } from '../../i18n';
import { nombrePlan } from '../../types/subscription.types';

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
            notifySuccess(t('Se canceló la eliminación de esta cuenta.', "This account's deletion was cancelled."));
            onCambio();
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo cancelar la eliminación.', "Couldn't cancel the deletion.")));
            throw e;
        }
    };

    const purgarAhora = async () => {
        if (motivoPurga.trim().length < 5) {
            setPurgaErr(t('Escribe un motivo de al menos 5 caracteres.', 'Write a reason of at least 5 characters.'));
            return;
        }
        if (!passAdmin) {
            setPurgaErr(t('Confirma con tu contraseña de administrador.', 'Confirm with your administrator password.'));
            return;
        }
        setPurgando(true);
        setPurgaErr('');
        try {
            await adminService.purgarAhora(idPropietario, { motivo: motivoPurga.trim(), contrasena_admin: passAdmin });
            navigate('/admin', { state: { notice: t(`La cuenta de ${detalle.nombre} fue purgada de inmediato.`, `${detalle.nombre}'s account was purged immediately.`) } });
        } catch (e) {
            setPurgaErr(getApiErrorMessage(e, t('No se pudo purgar la cuenta.', "Couldn't purge the account.")));
        } finally {
            setPurgando(false);
        }
    };

    const bloqueada = detalle.status_dms === 'liberado' || detalle.status_dms === 'eliminado';

    return (
        <div className="row g-4">
            <div className="col-md-4">
                <div className="stat-card h-100">
                    <p className="verif-label mb-2">{t('Bóvedas', 'Vaults')}</p>
                    <h3 className="fw-bold m-0" style={{ color: 'var(--escom-blue)' }}>{detalle.bovedas_total}</h3>
                </div>
            </div>
            <div className="col-md-4">
                <div className="stat-card h-100" style={{ borderTopColor: 'var(--ipn-maroon)' }}>
                    <p className="verif-label mb-2">{t('Custodios', 'Custodians')}</p>
                    <h3 className="fw-bold m-0" style={{ color: 'var(--ipn-maroon)' }}>{detalle.custodios_total}</h3>
                </div>
            </div>
            <div className="col-md-4">
                <div className="stat-card h-100">
                    <p className="verif-label mb-2">Plan</p>
                    <h3 className="fw-bold m-0">{nombrePlan(detalle.plan_nombre)}</h3>
                </div>
            </div>

            <div className="col-md-6">
                <div className="admin-card p-4 h-100">
                    <StorageMeter usado={detalle.usado_bytes} cuota={detalle.cuota_bytes} />
                </div>
            </div>

            <div className="col-md-6">
                <div className="admin-card p-4 h-100">
                    <h5 className="fw-bold mb-3">{t('Cuenta', 'Account')}</h5>

                    {detalle.eliminacion_solicitada_en ? (
                        <div className="mb-3">
                            <p className="small text-muted mb-2">
                                {t('Eliminación solicitada el', 'Deletion requested on')}{' '}
                                {new Date(detalle.eliminacion_solicitada_en).toLocaleString(locale())}.
                                {detalle.eliminacion_purga_en &&
                                    (getLang() === 'es' ? (
                                        <> Se purgará el {new Date(detalle.eliminacion_purga_en).toLocaleDateString(locale())} si nadie la cancela.</>
                                    ) : (
                                        <> It will be purged on {new Date(detalle.eliminacion_purga_en).toLocaleDateString(locale())} unless someone cancels it.</>
                                    ))}
                            </p>
                            <button className="btn btn-ipn btn-sm" onClick={() => setShowCancelar(true)}>
                                {t('Cancelar eliminación', 'Cancel deletion')}
                            </button>
                        </div>
                    ) : (
                        <p className="small text-muted mb-3">{t('No hay ninguna solicitud de eliminación pendiente.', 'There are no pending deletion requests.')}</p>
                    )}

                    <hr />
                    <p className="small text-muted mb-2">
                        {t('Purga irreversible sin periodo de gracia — solo para casos de soporte/legales (p. ej. una solicitud ARCO urgente).', 'Irreversible purge with no grace period — only for support/legal cases (e.g. an urgent ARCO request).')}
                    </p>
                    <button
                        className="btn btn-sm rounded-pill text-white"
                        style={{ background: 'var(--danger-red)' }}
                        onClick={() => setShowPurgar(true)}
                        disabled={bloqueada}
                        title={bloqueada ? t('Esta cuenta ya está liberada o eliminada.', 'This account is already released or deleted.') : undefined}
                    >
                        <i className="fas fa-user-slash me-2" /> {t('Purgar cuenta ahora', 'Purge account now')}
                    </button>
                </div>
            </div>

            {showCancelar && (
                <AdminMotivoModal
                    title={t('Cancelar eliminación de cuenta', 'Cancel account deletion')}
                    description={t('El propietario vuelve a tener acceso normal de inmediato.', 'The owner regains normal access immediately.')}
                    confirmLabel={t('Cancelar eliminación', 'Cancel deletion')}
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
                                <h4 className="fw-bold mb-1">{t('Purgar cuenta ahora', 'Purge account now')}</h4>
                                {getLang() === 'es' ? (
                                    <p className="text-muted small mb-4">
                                        Acción irreversible: borra bóvedas, activos y directorio de custodios, y anonimiza la
                                        identidad de <strong>{detalle.nombre}</strong>. Confírmalo con tu propia contraseña de
                                        administrador.
                                    </p>
                                ) : (
                                    <p className="text-muted small mb-4">
                                        Irreversible action: deletes vaults, assets and the custodian directory, and anonymizes
                                        the identity of <strong>{detalle.nombre}</strong>. Confirm it with your own administrator
                                        password.
                                    </p>
                                )}
                                {purgaErr && <div className="alert alert-danger py-2 small">{purgaErr}</div>}
                                <label className="form-label-b d-block">{t('Motivo (queda en la auditoría)', 'Reason (recorded in the audit log)')}</label>
                                <textarea
                                    className="form-control shadow-none mb-3"
                                    rows={2}
                                    value={motivoPurga}
                                    onChange={(e) => setMotivoPurga(e.target.value)}
                                    placeholder={t('Ej: solicitud ARCO urgente vía soporte.', 'e.g. urgent ARCO request via support.')}
                                />
                                <label className="form-label-b d-block">{t('Tu contraseña de administrador', 'Your administrator password')}</label>
                                <input
                                    type="password"
                                    className="form-control shadow-none mb-4"
                                    value={passAdmin}
                                    onChange={(e) => setPassAdmin(e.target.value)}
                                />
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={() => setShowPurgar(false)} disabled={purgando}>
                                        {t('Cancelar', 'Cancel')}
                                    </button>
                                    <button
                                        className="btn w-100 rounded-pill text-white"
                                        style={{ background: 'var(--danger-red)' }}
                                        onClick={purgarAhora}
                                        disabled={purgando}
                                    >
                                        {purgando ? t('Purgando…', 'Purging…') : t('Purgar ahora', 'Purge now')}
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
