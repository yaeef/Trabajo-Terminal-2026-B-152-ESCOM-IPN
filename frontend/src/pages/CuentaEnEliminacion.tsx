import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/AuthContext';
import { useNotice } from '../store/NoticeContext';
import { userService } from '../services/user.service';
import { purgeAll } from '../crypto/sensitiveMemory';
import { getApiErrorMessage } from '../utils/errors';
import './CuentaEnEliminacion.css';
import LanguageToggle from '../components/common/LanguageToggle';
import { getLang, locale, t } from '../i18n';


function fmtFecha(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(locale(), { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function CuentaEnEliminacion() {
    const { user, refreshUser, logout } = useAuth();
    const navigate = useNavigate();

    const [restaurando, setRestaurando] = useState(false);
    const { notifyError } = useNotice();

    const [modalAbierto, setModalAbierto] = useState(false);
    const [password, setPassword] = useState('');
    const [confirmWord, setConfirmWord] = useState('');
    const [borrando, setBorrando] = useState(false);
    const [modalErr, setModalErr] = useState('');

    const purgaEn = fmtFecha(user?.eliminacion_purga_en);
    // Palabra de confirmación (solo la valida el frontend; el backend pide la contraseña).
    const CONFIRM_WORD = t('ELIMINAR', 'DELETE');

    const restaurar = async () => {
        setRestaurando(true);
        try {
            await userService.cancelDeletion();
            await refreshUser();
            navigate('/dashboard', { replace: true });
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo restaurar la cuenta.', "Couldn't restore the account.")));
            setRestaurando(false);
        }
    };

    const eliminarAhora = async () => {
        setBorrando(true);
        setModalErr('');
        try {
            await userService.deleteNow(password);
            purgeAll(); // pone a cero llaves/fragmentos que sigan en RAM
            logout(); // quita el JWT
            window.location.assign('/'); // recarga completa: destruye heap JS + WASM
        } catch (e) {
            setModalErr(getApiErrorMessage(e, t('No se pudo eliminar la cuenta.', "Couldn't delete the account.")));
            setBorrando(false);
        }
    };

    const puedeBorrar = password.length > 0 && confirmWord.trim().toUpperCase() === CONFIRM_WORD;

    return (
        <div className="cuenta-elim-page">
            <div className="auth-theme-toggle">
                <LanguageToggle />
            </div>
            <div className="cuenta-elim-card">
                <div className="cuenta-elim-bar" />
                <div className="p-5">
                    <div className="text-center mb-3 text-danger">
                        <i className="fas fa-hourglass-half fa-3x" />
                    </div>
                    <h3 className="fw-bold text-center mb-2">{t('Tu cuenta está en cola de eliminación', 'Your account is queued for deletion')}</h3>
                    {getLang() === 'es' ? (
                        <p className="text-muted text-center mb-4">
                            Se eliminarán de forma permanente todas tus bóvedas, sus archivos y tu directorio de
                            custodios el{' '}
                            <strong>{purgaEn}</strong>. Mientras tanto la aplicación queda bloqueada y el
                            protocolo de vida está en pausa.
                        </p>
                    ) : (
                        <p className="text-muted text-center mb-4">
                            All your vaults, their files and your custodian directory will be permanently deleted on{' '}
                            <strong>{purgaEn}</strong>. Until then the app is locked and the life protocol is
                            paused.
                        </p>
                    )}

                    <div className="d-grid gap-2">
                        <button
                            className="btn btn-ipn rounded-pill py-2"
                            onClick={restaurar}
                            disabled={restaurando}
                        >
                            {restaurando ? t('Restaurando…', 'Restoring…') : t('Restaurar mi cuenta', 'Restore my account')}
                        </button>
                        <button
                            className="btn btn-outline-danger rounded-pill py-2"
                            onClick={() => {
                                setModalErr('');
                                setPassword('');
                                setConfirmWord('');
                                setModalAbierto(true);
                            }}
                        >
                            {t('Eliminar ahora', 'Delete now')}
                        </button>
                        <button
                            className="btn btn-link text-muted mt-1"
                            onClick={() => {
                                logout();
                                window.location.assign('/');
                            }}
                        >
                            {t('Cerrar sesión', 'Sign out')}
                        </button>
                    </div>
                </div>
            </div>

            {modalAbierto && (
                <div
                    className="modal fade show d-block"
                    tabIndex={-1}
                    style={{ background: 'rgba(15,23,42,0.6)' }}
                >
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg" style={{ borderRadius: 20, overflow: 'hidden' }}>
                            <div style={{ height: 6, background: 'var(--danger-red, #ef4444)' }} />
                            <div className="modal-body p-5">
                                <div className="text-center mb-3 text-danger">
                                    <i className="fas fa-triangle-exclamation fa-3x" />
                                </div>
                                <h4 className="fw-bold text-center mb-1">{t('Eliminar ahora', 'Delete now')}</h4>
                                <p className="text-muted small text-center mb-4">
                                    {t('No esperará al plazo: tu patrimonio se borra ya y tu identidad queda anonimizada. No se puede deshacer.', "It won't wait for the deadline: your estate is deleted right away and your identity is anonymized. This can't be undone.")}
                                </p>

                                {modalErr && <div className="alert alert-danger py-2 small">{modalErr}</div>}

                                <label className="cuenta-elim-label d-block mb-1">{t('Contraseña de la cuenta', 'Account password')}</label>
                                <input
                                    type="password"
                                    className="form-control shadow-none mb-3"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={borrando}
                                />

                                <label className="cuenta-elim-label d-block mb-1">
                                    {t('Escribe', 'Type')} <code>{CONFIRM_WORD}</code> {t('para confirmar', 'to confirm')}
                                </label>
                                <input
                                    type="text"
                                    className="form-control shadow-none mb-4"
                                    value={confirmWord}
                                    onChange={(e) => setConfirmWord(e.target.value)}
                                    disabled={borrando}
                                />

                                <div className="d-flex gap-3">
                                    <button
                                        className="btn btn-light w-100 rounded-pill"
                                        onClick={() => setModalAbierto(false)}
                                        disabled={borrando}
                                    >
                                        {t('Cancelar', 'Cancel')}
                                    </button>
                                    <button
                                        className="btn btn-danger w-100 rounded-pill"
                                        onClick={eliminarAhora}
                                        disabled={!puedeBorrar || borrando}
                                    >
                                        {borrando ? t('Eliminando…', 'Deleting…') : t('Eliminar permanentemente', 'Delete permanently')}
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
