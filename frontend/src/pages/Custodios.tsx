import { useEffect, useState } from 'react';
import DashboardLayout from '../components/layout/DashboardLayout';
import { custodiosService } from '../services/custodios.service';
import { useNotice } from '../store/NoticeContext';
import { PARENTESCO_OPCIONES, type CustodioResponse } from '../types/custodios.types';
import { getApiErrorMessage } from '../utils/errors';
import './Custodios.css';

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
        <span className={`verif-tag ${ok ? 'v-ok' : 'v-no'}`}>{ok ? 'Verificado' : 'No verificado'}</span>
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
                notifyError(getApiErrorMessage(e, 'No se pudo cargar el directorio.'));
            })
            .finally(() => setLoading(false));
    };
    useEffect(load, []);

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
                notifySuccess('Custodio actualizado. Si cambiaste el correo, se reenvió la verificación.');
            } else {
                await custodiosService.create(base);
                notifySuccess(`Le enviamos a ${form.correo} el enlace para confirmar su correo y otro para vincular su Telegram.`);
            }
            setForm(null);
            load();
        } catch (e) {
            setFormErr(getApiErrorMessage(e, 'No se pudo guardar el custodio.'));
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
            notifyError(getApiErrorMessage(e, 'No se pudo reenviar la verificación.'));
        } finally {
            setResendingId(null);
        }
    };

    const linkTelegram = async (c: CustodioResponse) => {
        setLinkingTelegramId(c.id);
        try {
            await custodiosService.requestTelegramLink(c.id);
            notifySuccess(`Se reenvió el enlace de vinculación de Telegram al correo de ${c.nombre_completo || c.nombre}.`);
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo enviar el enlace de vinculación de Telegram.'));
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
            notifySuccess('Custodio eliminado del directorio.');
            load();
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo eliminar el custodio.'));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <DashboardLayout activeItem="custodios" topBarLabel="Directorio de Custodios">
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">Red de Contactos</h2>
                    <p className="text-muted m-0">Contactos de confianza. No tienen cuenta; solo se les notifica en la recuperación.</p>
                </div>
                <button className="btn btn-ipn" onClick={() => { setForm({ ...EMPTY }); setFormErr(''); }}>
                    <i className="fas fa-user-plus me-2" /> Registrar Custodio
                </button>
            </div>

            {loading && <p className="text-muted">Cargando…</p>}

            {!loading && custodios.length === 0 && !loadFailed && (
                <div className="cust-card text-center text-muted py-5">
                    <i className="fas fa-users-slash fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }} />
                    Aún no registras custodios.
                </div>
            )}

            {custodios.length > 0 && (
                <div className="cust-card p-0">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead style={{ background: '#f8fafc' }}>
                                <tr>
                                    <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">Custodio</th>
                                    <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Canales y verificación</th>
                                    <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {custodios.map((c) => (
                                    <tr key={c.id}>
                                        <td className="ps-4">
                                            <div className="fw-bold">{c.nombre_completo || c.nombre}</div>
                                            <div className="text-muted small">
                                                <span className="parentesco-chip">{c.parentesco}</span>
                                                <span className="ms-2">ID #C-{c.id}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div className="channel-row">
                                                <span className="small">
                                                    <i className="fas fa-envelope text-muted me-2" />
                                                    {c.correo}
                                                </span>
                                                <span className="d-inline-flex align-items-center gap-2">
                                                    {!c.correo_verificado && (
                                                        <button
                                                            className="btn btn-link btn-sm p-0 small"
                                                            onClick={() => resend(c)}
                                                            disabled={resendingId === c.id}
                                                        >
                                                            {resendingId === c.id ? 'Enviando…' : 'Reenviar'}
                                                        </button>
                                                    )}
                                                    <VerifTag ok={c.correo_verificado} />
                                                </span>
                                            </div>
                                            {!c.correo_verificado && !c.telegram_verificado && (
                                                <p className="m-0 mt-1 small" style={{ color: 'var(--danger-red)', fontSize: '0.68rem' }}>
                                                    <i className="fas fa-triangle-exclamation me-1" />
                                                    Sin canal verificado: no se puede vincular a bóvedas.
                                                </p>
                                            )}
                                            <div className="channel-row">
                                                <span className="small">
                                                    <i className="fab fa-telegram text-info me-2" />
                                                    Telegram
                                                </span>
                                                <span className="d-inline-flex align-items-center gap-2">
                                                    {!c.telegram_verificado && (
                                                        <button
                                                            className="btn btn-link btn-sm p-0 small"
                                                            onClick={() => linkTelegram(c)}
                                                            disabled={linkingTelegramId === c.id}
                                                        >
                                                            {linkingTelegramId === c.id ? 'Enviando…' : 'Reenviar enlace'}
                                                        </button>
                                                    )}
                                                    <VerifTag ok={c.telegram_verificado} />
                                                </span>
                                            </div>
                                        </td>
                                        <td className="pe-4 text-end">
                                            <button
                                                className="btn btn-sm btn-outline-secondary rounded-pill me-1"
                                                title="Editar"
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
                                                title="Eliminar"
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
                                <h4 className="fw-bold mb-1">{isEdit ? 'Modificar custodio' : 'Nuevo custodio'}</h4>
                                <p className="text-muted small mb-4">
                                    {isEdit
                                        ? 'Si cambias el correo, el custodio deberá verificarlo de nuevo.'
                                        : 'Se enviará un enlace de validación al correo.'}
                                </p>
                                {formErr && <div className="alert alert-danger py-2 small">{formErr}</div>}
                                <div className="row g-2 mb-3">
                                    <div className="col-12">
                                        <label className="form-label-b d-block">Nombre(s)</label>
                                        <input
                                            className="form-control shadow-none"
                                            value={form.nombre}
                                            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                                            placeholder="Ej: Juan Carlos"
                                        />
                                    </div>
                                    <div className="col-6">
                                        <label className="form-label-b d-block">Apellido paterno</label>
                                        <input
                                            className="form-control shadow-none"
                                            value={form.paterno}
                                            onChange={(e) => setForm({ ...form, paterno: e.target.value })}
                                            placeholder="Pérez"
                                        />
                                    </div>
                                    <div className="col-6">
                                        <label className="form-label-b d-block">Apellido materno</label>
                                        <input
                                            className="form-control shadow-none"
                                            value={form.materno}
                                            onChange={(e) => setForm({ ...form, materno: e.target.value })}
                                            placeholder="López"
                                        />
                                    </div>
                                </div>
                                <label className="form-label-b d-block">Parentesco</label>
                                <select
                                    className="form-select shadow-none mb-3"
                                    value={form.parentesco}
                                    onChange={(e) => setForm({ ...form, parentesco: e.target.value })}
                                >
                                    {PARENTESCO_OPCIONES.map((p) => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                                <label className="form-label-b d-block">Correo electrónico</label>
                                <input
                                    type="email"
                                    className="form-control shadow-none mb-3"
                                    value={form.correo}
                                    onChange={(e) => setForm({ ...form, correo: e.target.value })}
                                    placeholder="correo@ejemplo.com"
                                />
                                {!isEdit && (
                                    <p className="text-muted small mb-4">
                                        <i className="fab fa-telegram text-info me-1" />
                                        Al registrarlo le enviaremos por correo dos enlaces: uno para confirmar su
                                        correo y otro para vincular su Telegram (vence en 3 días). Si se le pasa,
                                        puedes reenviarlo desde el directorio.
                                    </p>
                                )}
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={() => setForm(null)} disabled={saving}>
                                        Cancelar
                                    </button>
                                    <button
                                        className="btn btn-ipn w-100"
                                        onClick={submit}
                                        disabled={saving || !form.nombre.trim() || !form.correo.trim()}
                                    >
                                        {saving ? 'Guardando…' : isEdit ? 'Actualizar' : 'Registrar'}
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
                                <h4 className="fw-bold">Eliminar custodio</h4>
                                <p className="text-muted small">
                                    Se quitará <strong>{toDelete.nombre_completo || toDelete.nombre}</strong> del
                                    directorio. Si estaba vinculado a alguna bóveda, esa vinculación no se toca aquí.
                                </p>
                                <div className="d-flex gap-3">
                                    <button className="btn btn-light w-100 rounded-pill" onClick={() => setToDelete(null)} disabled={deleting}>
                                        Cancelar
                                    </button>
                                    <button
                                        className="btn w-100 rounded-pill text-white"
                                        style={{ background: 'var(--danger-red)' }}
                                        onClick={confirmDelete}
                                        disabled={deleting}
                                    >
                                        {deleting ? 'Eliminando…' : 'Eliminar'}
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
