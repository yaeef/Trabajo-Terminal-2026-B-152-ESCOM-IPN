import { useEffect, useState } from 'react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { custodiosService } from '../services/custodios.service';
import { subscriptionService } from '../services/subscription.service';
import { useNotice } from '../store/NoticeContext';
import { PARENTESCO_OPCIONES, parentescoLabel, type CustodioResponse } from '../types/custodios.types';
import { getApiErrorMessage } from '../utils/errors';
import './Custodios.css';
import { getLang, t } from '../i18n';

type FormState = {
    id: number | null;
    nombre: string;
    paterno: string;
    materno: string;
    parentesco: string;
    correo: string;
};
const EMPTY: FormState = {
    id: null,
    nombre: '',
    paterno: '',
    materno: '',
    parentesco: 'Familiar',
    correo: '',
};

function VerifTag({ ok }: { ok: boolean }) {
    return (
        <span className={`verif-tag ${ok ? 'v-ok' : 'v-no'}`}>{ok ? t('Verificado', 'Verified') : t('No verificado', 'Not verified')}</span>
    );
}

export default function Custodios() {
    const [custodios, setCustodios] = useState<CustodioResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const { notifyError, notifySuccess } = useNotice();

    const [form, setForm] = useState<FormState | null>(null); // null = cerrado
    const [saving, setSaving] = useState(false);
    const [formErr, setFormErr] = useState('');

    const [toDelete, setToDelete] = useState<CustodioResponse | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [resendingId, setResendingId] = useState<number | null>(null);
    const [linkingTelegramId, setLinkingTelegramId] = useState<number | null>(null);

    const load = () => {
        setLoading(true);
        setLoadFailed(false);
        custodiosService
            .list()
            .then(setCustodios)
            .catch((e) => {
                setLoadFailed(true);
                notifyError(getApiErrorMessage(e, t('No se pudo cargar el directorio.', "Couldn't load the directory.")));
            })
            .finally(() => setLoading(false));
    };
    useEffect(load, []);

    // Custodios del plan (los que se usan en bóvedas); se puede registrar 1 más de reemplazo.
    const [maxPlan, setMaxPlan] = useState<number | null>(null);
    useEffect(() => {
        subscriptionService
            .getActual()
            .then((a) => setMaxPlan(a.plan.max_custodios))
            .catch(() => undefined);
    }, []);

    const isEdit = form?.id != null;

    const submit = async () => {
        if (!form) return;
        setSaving(true);
        setFormErr('');
        try {
            const base = {
                nombre: form.nombre.trim(),
                paterno: form.paterno.trim() || null,
                materno: form.materno.trim() || null,
                parentesco: form.parentesco,
                correo: form.correo.trim(),
            };
            if (isEdit) {
                await custodiosService.update(form.id!, base);
                notifySuccess(t('Custodio actualizado. Si cambiaste el correo, se reenvió la verificación.', 'Custodian updated. If you changed the email, the verification was resent.'));
            } else {
                await custodiosService.create(base);
                notifySuccess(
                    t(
                        `Le enviamos a ${form.correo} el enlace para confirmar su correo y otro para vincular su Telegram.`,
                        `We sent ${form.correo} a link to confirm their email and another to link their Telegram.`,
                    ),
                );
            }
            setForm(null);
            load();
        } catch (e) {
            setFormErr(getApiErrorMessage(e, t('No se pudo guardar el custodio.', "Couldn't save the custodian.")));
        } finally {
            setSaving(false);
        }
    };

    const resend = async (c: CustodioResponse) => {
        setResendingId(c.id);
        try {
            const { detail } = await custodiosService.resendVerification(c.id);
            notifySuccess(detail);
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo reenviar la verificación.', "Couldn't resend the verification.")));
        } finally {
            setResendingId(null);
        }
    };

    const linkTelegram = async (c: CustodioResponse) => {
        setLinkingTelegramId(c.id);
        try {
            await custodiosService.requestTelegramLink(c.id);
            notifySuccess(
                t(
                    `Se reenvió el enlace de vinculación de Telegram al correo de ${c.nombre_completo || c.nombre}.`,
                    `The Telegram linking link was resent to ${c.nombre_completo || c.nombre}'s email.`,
                ),
            );
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo enviar el enlace de vinculación de Telegram.', "Couldn't send the Telegram linking link.")));
        } finally {
            setLinkingTelegramId(null);
        }
    };

    const confirmDelete = async () => {
        if (!toDelete) return;
        setDeleting(true);
        try {
            await custodiosService.remove(toDelete.id);
            setToDelete(null);
            notifySuccess(t('Custodio eliminado del directorio.', 'Custodian removed from the directory.'));
            load();
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo eliminar el custodio.', "Couldn't delete the custodian.")));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <DashboardLayout activeItem="custodios" topBarLabel={t('Directorio de Custodios', 'Custodian Directory')}>
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">{t('Red de Contactos', 'Contact Network')}</h2>
                    <p className="text-muted m-0">{t('Contactos de confianza. No tienen cuenta; solo se les notifica en la recuperación.', "Trusted contacts. They don't have an account; they're only notified during recovery.")}</p>
                </div>
                <button className="btn btn-ipn" onClick={() => { setForm({ ...EMPTY }); setFormErr(''); }}>
                    <i className="fas fa-user-plus me-2" /> {t('Registrar Custodio', 'Register Custodian')}
                </button>
            </div>

            {!loading && maxPlan !== null && custodios.length >= maxPlan && (
                <div className="cust-reserva mb-4">
                    <i className="fas fa-user-clock me-2" aria-hidden="true" />
                    {getLang() === 'es' ? (
                        custodios.length === maxPlan ? (
                            <>
                                Tu plan usa <strong>{maxPlan} custodios</strong> en tus bóvedas. Puedes registrar{' '}
                                <strong>1 más de reemplazo</strong>: después, en Gestionar Bóveda, ponlo en lugar del que
                                quieras cambiar y elimina al anterior.
                            </>
                        ) : (
                            <>
                                Ya registraste tu custodio de reemplazo. En tus bóvedas solo se usan {maxPlan}: ponlo en
                                lugar de otro desde Gestionar Bóveda y luego elimina al anterior.
                            </>
                        )
                    ) : custodios.length === maxPlan ? (
                        <>
                            Your plan uses <strong>{maxPlan} custodians</strong> in your vaults. You can register{' '}
                            <strong>1 more as a replacement</strong>: then, in Manage Vault, put them in place of the one
                            you want to change and delete the previous one.
                        </>
                    ) : (
                        <>
                            You already registered your replacement custodian. Only {maxPlan} are used in your vaults:
                            put them in place of another from Manage Vault and then delete the previous one.
                        </>
                    )}
                </div>
            )}

            {loading && <p className="text-muted">{t('Cargando…', 'Loading…')}</p>}

            {!loading && custodios.length === 0 && !loadFailed && (
                <div className="cust-card text-center text-muted py-5">
                    <i className="fas fa-users-slash fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }} />
                    {t('Aún no registras custodios.', "You haven't registered any custodians yet.")}
                </div>
            )}

            {custodios.length > 0 && (
                <div className="cust-card p-0">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead style={{ background: '#f8fafc' }}>
                                <tr>
                                    <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">{t('Custodio', 'Custodian')}</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">{t('Canales y verificación', 'Channels and verification')}</th>
                                    <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">{t('Acciones', 'Actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {custodios.map((c) => (
                                    <tr key={c.id}>
                                        <td className="ps-4">
                                            <div className="fw-bold">{c.nombre_completo || c.nombre}</div>
                                            <div className="text-muted small">
                                                <span className="parentesco-chip">{parentescoLabel(c.parentesco)}</span>
                                                <span className="ms-2">ID #C-{c.id}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div className="channel-row">
                                                <span className="channel-label" title={c.correo}>
                                                    <i className="fas fa-envelope text-muted" />
                                                    <span className="channel-text">{c.correo}</span>
                                                </span>
                                                <span className="channel-estado">
                                                    {!c.correo_verificado && (
                                                        <button
                                                            type="button"
                                                            className="channel-accion"
                                                            onClick={() => resend(c)}
                                                            disabled={resendingId === c.id}
                                                            title={t('Reenviar el correo de verificación', 'Resend the verification email')}
                                                        >
                                                            <i className="fas fa-paper-plane" />
                                                            {resendingId === c.id ? t('Enviando…', 'Sending…') : t('Reenviar', 'Resend')}
                                                        </button>
                                                    )}
                                                    <VerifTag ok={c.correo_verificado} />
                                                </span>
                                            </div>
                                            {!c.correo_verificado && !c.telegram_verificado && (
                                                <p className="m-0 mt-1 small" style={{ color: 'var(--danger-red)', fontSize: '0.68rem' }}>
                                                    <i className="fas fa-triangle-exclamation me-1" />
                                                    {t('Sin canal verificado: no se puede vincular a bóvedas.', "No verified channel: can't be linked to vaults.")}
                                                </p>
                                            )}
                                            <div className="channel-row">
                                                <span className="channel-label">
                                                    <i className="fab fa-telegram text-info" />
                                                    <span className="channel-text">Telegram</span>
                                                </span>
                                                <span className="channel-estado">
                                                    {!c.telegram_verificado && (
                                                        <button
                                                            type="button"
                                                            className="channel-accion"
                                                            onClick={() => linkTelegram(c)}
                                                            disabled={linkingTelegramId === c.id}
                                                            title={t('Reenviar el enlace para vincular Telegram', 'Resend the link to connect Telegram')}
                                                        >
                                                            <i className="fas fa-paper-plane" />
                                                            {linkingTelegramId === c.id ? t('Enviando…', 'Sending…') : t('Reenviar', 'Resend')}
                                                        </button>
                                                    )}
                                                    <VerifTag ok={c.telegram_verificado} />
                                                </span>
                                            </div>
                                        </td>
                                        <td className="pe-4 text-end">
                                            <button
                                                className="btn btn-sm btn-outline-secondary rounded-pill me-1"
                                                title={t('Editar', 'Edit')}
                                                onClick={() =>
                                                    setForm({
                                                        id: c.id,
                                                        nombre: c.nombre,
                                                        paterno: c.paterno ?? '',
                                                        materno: c.materno ?? '',
                                                        parentesco: c.parentesco || 'Familiar',
                                                        correo: c.correo,
                                                    })
                                                }
                                            >
                                                <i className="fas fa-user-edit" />
                                            </button>
                                            <button
                                                className="btn btn-sm btn-outline-danger rounded-pill"
                                                title={t('Eliminar', 'Delete')}
                                                onClick={() => setToDelete(c)}
                                            >
                                                <i className="fas fa-trash" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Modal registrar / editar */}
            {form && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" style={isEdit ? { background: 'var(--escom-blue)' } : undefined} />
                            <div className="modal-body p-5">
                                <h4 className="fw-bold mb-1">{isEdit ? t('Modificar custodio', 'Edit custodian') : t('Nuevo custodio', 'New custodian')}</h4>
                                <p className="text-muted small mb-4">
                                    {isEdit
                                        ? t('Si cambias el correo, el custodio deberá verificarlo de nuevo.', 'If you change the email, the custodian will have to verify it again.')
                                        : t('Se enviará un enlace de validación al correo.', 'A validation link will be sent to the email.')}
                                </p>
                                {formErr && <div className="alert alert-danger py-2 small">{formErr}</div>}
                                <div className="row g-2 mb-3">
                                    <div className="col-12">
                                        <label className="form-label-b d-block">{t('Nombre(s)', 'First name(s)')}</label>
                                        <input
                                            className="form-control shadow-none"
                                            value={form.nombre}
                                            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                                            placeholder={t('Ej: Juan Carlos', 'e.g. John Charles')}
                                        />
                                    </div>
                                    <div className="col-6">
                                        <label className="form-label-b d-block">{t('Apellido paterno', 'Paternal surname')}</label>
                                        <input
                                            className="form-control shadow-none"
                                            value={form.paterno}
                                            onChange={(e) => setForm({ ...form, paterno: e.target.value })}
                                            placeholder={t('Pérez', 'Smith')}
                                        />
                                    </div>
                                    <div className="col-6">
                                        <label className="form-label-b d-block">{t('Apellido materno', 'Maternal surname')}</label>
                                        <input
                                            className="form-control shadow-none"
                                            value={form.materno}
                                            onChange={(e) => setForm({ ...form, materno: e.target.value })}
                                            placeholder={t('López', 'Jones')}
                                        />
                                    </div>
                                </div>
                                <label className="form-label-b d-block">{t('Parentesco', 'Relationship')}</label>
                                <select
                                    className="form-select shadow-none mb-3"
                                    value={form.parentesco}
                                    onChange={(e) => setForm({ ...form, parentesco: e.target.value })}
                                >
                                    {PARENTESCO_OPCIONES.map((p) => (
                                        <option key={p} value={p}>{parentescoLabel(p)}</option>
                                    ))}
                                </select>
                                <label className="form-label-b d-block">{t('Correo electrónico', 'Email address')}</label>
                                <input
                                    type="email"
                                    className="form-control shadow-none mb-3"
                                    value={form.correo}
                                    onChange={(e) => setForm({ ...form, correo: e.target.value })}
                                    placeholder={t('correo@ejemplo.com', 'email@example.com')}
                                />
                                {!isEdit && (
                                    <p className="text-muted small mb-4">
                                        <i className="fab fa-telegram text-info me-1" />
                                        {t('Al registrarlo le enviaremos por correo dos enlaces: uno para confirmar su correo y otro para vincular su Telegram (vence en 3 días). Si se le pasa, puedes reenviarlo desde el directorio.', "When you register them we'll email two links: one to confirm their email and another to link their Telegram (expires in 3 days). If they miss it, you can resend it from the directory.")}
                                    </p>
                                )}
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={() => setForm(null)} disabled={saving}>
                                        {t('Cancelar', 'Cancel')}
                                    </button>
                                    <button
                                        className="btn btn-ipn w-100"
                                        onClick={submit}
                                        disabled={saving || !form.nombre.trim() || !form.correo.trim()}
                                    >
                                        {saving ? t('Guardando…', 'Saving…') : isEdit ? t('Actualizar', 'Update') : t('Registrar', 'Register')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal eliminar */}
            {toDelete && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" style={{ background: 'var(--danger-red)' }} />
                            <div className="modal-body p-5 text-center">
                                <div className="mb-3 text-danger"><i className="fas fa-user-slash fa-3x" /></div>
                                <h4 className="fw-bold">{t('Eliminar custodio', 'Delete custodian')}</h4>
                                {getLang() === 'es' ? (
                                    <p className="text-muted small">
                                        Se quitará <strong>{toDelete.nombre_completo || toDelete.nombre}</strong> del
                                        directorio. Si estaba vinculado a alguna bóveda, esa vinculación no se toca aquí.
                                    </p>
                                ) : (
                                    <p className="text-muted small">
                                        <strong>{toDelete.nombre_completo || toDelete.nombre}</strong> will be removed from
                                        the directory. If they were linked to any vault, that link isn't changed here.
                                    </p>
                                )}
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={() => setToDelete(null)} disabled={deleting}>
                                        {t('Cancelar', 'Cancel')}
                                    </button>
                                    <button
                                        className="btn w-100 rounded-pill text-white"
                                        style={{ background: 'var(--danger-red)' }}
                                        onClick={confirmDelete}
                                        disabled={deleting}
                                    >
                                        {deleting ? t('Eliminando…', 'Deleting…') : t('Eliminar', 'Delete')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
