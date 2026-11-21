import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../../services/auth.service';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import './AuthTheme.css';
import RequisitosContrasena from '../../components/common/RequisitosContrasena';
import { requisitoFaltante } from '../../utils/password';
import KleimosLogo from '../../components/brand/KleimosLogo';
import LanguageToggle from '../../components/common/LanguageToggle';
import { t } from '../../i18n';

/**
 * CU-005 (paso 2): ingresar la nueva contraseña usando el token recibido
 * por correo/Telegram. Corresponde a FRONTEND_RESET_URL en el backend
 * (?token=...) — registrada en /reset-password para coincidir con
 * FRONTEND_RESET_URL=http://localhost:5173/reset-password del .env.
 */
export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') ?? '';

    const [nuevaPassword, setNuevaPassword] = useState('');
    const [confirmar, setConfirmar] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const navigate = useNavigate();
    const { notifyError } = useNotice();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const falta = requisitoFaltante(nuevaPassword);
        if (falta) {
            notifyError(falta);
            return;
        }
        if (nuevaPassword !== confirmar) {
            notifyError(t('Las contraseñas no coinciden.', "Passwords don't match."));
            return;
        }

        setIsSubmitting(true);
        try {
            await authService.resetPassword({ token, nueva_password: nuevaPassword });
            setSuccess(true);
            setTimeout(() => navigate('/login'), 2500);
        } catch (err) {
            notifyError(getApiErrorMessage(err, t('No se pudo restablecer la contraseña.', "Couldn't reset the password.")));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!token) {
        return (
            <div className="auth-page">
                <div className="auth-theme-toggle">
                    <LanguageToggle />
                </div>
                <div className="card-auth animate__animated animate__fadeInUp">
                    <div className="top-gradient"></div>
                    <div className="card-body p-4 p-md-5 text-center">
                        <div className="auth-logo">
                            <KleimosLogo tamano="md" />
                        </div>
                        <div className="error-icon-circle animate__animated animate__bounceIn">
                            <i className="fas fa-link-slash fa-3x"></i>
                        </div>
                        <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>{t('Enlace inválido', 'Invalid link')}</h3>
                        <p className="text-muted">{t('Este enlace no incluye un token de recuperación válido.', "This link doesn't include a valid recovery token.")}</p>
                        <Link to="/recuperar-password" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                            {t('Solicitar uno nuevo', 'Request a new one')} <i className="fas fa-arrow-right ms-2"></i>
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    if (success) {
        return (
            <div className="auth-page">
                <div className="auth-theme-toggle">
                    <LanguageToggle />
                </div>
                <div className="card-auth animate__animated animate__fadeInUp">
                    <div className="top-gradient"></div>
                    <div className="card-body p-4 p-md-5 text-center">
                        <div className="auth-logo">
                            <KleimosLogo tamano="md" />
                        </div>
                        <div className="success-icon-circle animate__animated animate__bounceIn">
                            <i className="fas fa-check fa-3x"></i>
                        </div>
                        <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>{t('Contraseña actualizada', 'Password updated')}</h3>
                        <p className="text-muted">{t('Redirigiendo al login...', 'Redirecting to sign in...')}</p>
                        <div className="progress-timer" style={{ width: '0%' }}></div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-page">
            <div className="auth-theme-toggle">
                <LanguageToggle />
            </div>
            <div className="card-auth animate__animated animate__fadeInUp">
                <div className="top-gradient"></div>
                <div className="card-body p-4 p-md-5">
                    <div className="auth-logo">
                        <KleimosLogo tamano="md" />
                    </div>
                    <div className="text-center mb-4">
                        <div className="d-inline-block p-3 rounded-circle bg-light shadow-sm">
                            <i className="fas fa-lock fa-3x" style={{ color: 'var(--escom-blue)' }}></i>
                        </div>
                        <h3 className="fw-bold mb-1 mt-3" style={{ color: 'var(--escom-blue)' }}>
                            {t('Restablecer contraseña', 'Reset password')}
                        </h3>
                        <p className="text-muted small">{t('Ingresa tu nueva contraseña.', 'Enter your new password.')}</p>
                    </div>

                    <form onSubmit={handleSubmit}>
                        <div className="mb-3">
                            <label className="form-label small fw-bold text-muted">{t('Nueva contraseña', 'New password')}</label>
                            <div className="input-group">
                                <span className="input-group-text"><i className="fas fa-lock"></i></span>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    className="form-control shadow-none"
                                    placeholder={t('Mínimo 12 caracteres', 'At least 12 characters')}
                                    value={nuevaPassword}
                                    onChange={(e) => setNuevaPassword(e.target.value)}
                                    required
                                />
                                <button
                                    type="button"
                                    className="input-group-text"
                                    role="button"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    aria-label={showPassword ? t('Ocultar contraseña', 'Hide password') : t('Mostrar contraseña', 'Show password')}
                                    title={showPassword ? t('Ocultar contraseña', 'Hide password') : t('Mostrar contraseña', 'Show password')}
                                >
                                    <i className={showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                </button>
                            </div>
                        </div>

                        <div className="mb-4">
                            <label className="form-label small fw-bold text-muted">{t('Confirmar nueva contraseña', 'Confirm new password')}</label>
                            <div className="input-group">
                                <span className="input-group-text"><i className="fas fa-check-double"></i></span>
                                <input
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    className="form-control shadow-none"
                                    placeholder="••••••••••••"
                                    value={confirmar}
                                    onChange={(e) => setConfirmar(e.target.value)}
                                    required
                                />
                                <button
                                    type="button"
                                    className="input-group-text"
                                    role="button"
                                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                                    aria-label={showConfirmPassword ? t('Ocultar contraseña', 'Hide password') : t('Mostrar contraseña', 'Show password')}
                                    title={showConfirmPassword ? t('Ocultar contraseña', 'Hide password') : t('Mostrar contraseña', 'Show password')}
                                >
                                    <i className={showConfirmPassword ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                </button>
                            </div>
                        </div>
                        <div className="mb-4">
                            <RequisitosContrasena password={nuevaPassword} confirmacion={confirmar} />
                        </div>

                        <button type="submit" className="btn btn-ipn w-100 py-3 mb-3 shadow-sm" disabled={isSubmitting}>
                            {isSubmitting ? (
                                t('Guardando...', 'Saving...')
                            ) : (
                                <>{t('Restablecer contraseña', 'Reset password')} <i className="fas fa-shield-halved ms-2"></i></>
                            )}
                        </button>
                    </form>

                    <div className="text-center">
                        <Link to="/login" className="text-decoration-none fw-bold small" style={{ color: 'var(--escom-blue)' }}>
                            <i className="fas fa-arrow-left me-1"></i> {t('Volver al login', 'Back to sign in')}
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
