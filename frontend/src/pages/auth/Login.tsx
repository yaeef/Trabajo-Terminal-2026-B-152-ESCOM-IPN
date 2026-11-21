import { useState } from 'react';
import { isAxiosError } from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import { getTheme, toggleTheme } from '../../theme';
import ReenviarConfirmacion from '../../components/common/ReenviarConfirmacion';
import LanguageToggle from '../../components/common/LanguageToggle';
import { t } from '../../i18n';
import './Login.css';
import KleimosLogo from '../../components/brand/KleimosLogo';

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [theme, setTheme] = useState(getTheme());
    // Contraseña correcta pero correo sin confirmar: mensaje + botón de reenvío.
    const [sinConfirmar, setSinConfirmar] = useState<string | null>(null);
    const { login } = useAuth();
    const { notifyError } = useNotice();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSinConfirmar(null);
        try {
            const me = await login(username, password);
            if (me?.rol === 'admin') {
                navigate('/admin', { replace: true });
                return;
            }
            if (me?.status_dms === 'liberado') {
                // Caso poco probable pero real: el propietario reaparece
                // después de que su patrimonio ya se liberó (venció el plazo
                // o los custodios confirmaron el fallecimiento). En vez del
                // dashboard normal, se le explica qué pasó antes que nada.
                navigate('/patrimonio-liberado', { replace: true });
                return;
            }
            // El check-in real ocurre en el backend durante /auth/login
            // (dms_service.registrar_prueba_de_vida). Este flag le indica
            // al Dashboard que muestre el aviso de check-in SOLO esta vez,
            // no en cada visita posterior.
            navigate('/dashboard', { state: { justLoggedIn: true } });
        } catch (err) {
            if (isAxiosError(err) && err.response?.status === 403) {
                // Contraseña correcta pero correo sin confirmar: se ofrece
                // reenviar el enlace (no se reenvía solo: invalida el anterior).
                setSinConfirmar(getApiErrorMessage(err, t('Tu cuenta aún no está activada.', 'Your account is not activated yet.')));
            } else {
                notifyError(getApiErrorMessage(err, t('Credenciales inválidas', 'Invalid credentials')));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="login-page">
            <div className="auth-theme-toggle">
                <LanguageToggle />
                <button
                    type="button"
                    className="theme-toggle"
                    onClick={() => setTheme(toggleTheme())}
                    title={theme === 'dark' ? t('Modo claro', 'Light mode') : t('Modo oscuro', 'Dark mode')}
                    aria-label={t('Cambiar tema', 'Toggle theme')}
                >
                    <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
                </button>
            </div>

            <div className="card card-login animate__animated animate__zoomIn">
                <div className="top-gradient"></div>

                <div className="card-body p-4 p-md-5">
                    <div className="auth-logo">
                        <KleimosLogo tamano="md" />
                    </div>
                    {/* Header */}
                    <div className="text-center mb-4">
                        <h3 className="fw-bold mb-1" style={{ color: 'var(--escom-blue)' }}>
                            {t('Iniciar sesión', 'Sign in')}
                        </h3>
                        <p className="text-muted small">{t('Ingresa tus credenciales', 'Enter your credentials')}</p>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* Usuario o correo */}
                        <div className="mb-3">
                            <label className="form-label small fw-bold text-muted">{t('Usuario o Correo', 'Username or Email')}</label>
                            <div className="input-group">
                                <span className="input-group-text">
                                    <i className="fas fa-fingerprint"></i>
                                </span>
                                <input
                                    type="text"
                                    className="form-control shadow-none"
                                    placeholder={t('ejemplo@correo.com', 'example@email.com')}
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        {/* Contraseña */}
                        <div className="mb-4">
                            <div className="d-flex justify-content-between">
                                <label className="form-label small fw-bold text-muted">{t('Contraseña', 'Password')}</label>
                                <Link
                                    to="/recuperar-password"
                                    className="text-decoration-none small fw-bold"
                                    style={{ color: 'var(--ipn-maroon)' }}
                                >
                                    {t('¿Olvidaste la contraseña?', 'Forgot your password?')}
                                </Link>
                            </div>
                            <div className="input-group">
                                <span className="input-group-text">
                                    <i className="fas fa-key"></i>
                                </span>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    className="form-control shadow-none"
                                    placeholder="••••••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                />
                                <button
                                    type="button"
                                    className="input-group-text"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    aria-label={showPassword ? t('Ocultar contraseña', 'Hide password') : t('Mostrar contraseña', 'Show password')}
                                    title={showPassword ? t('Ocultar contraseña', 'Hide password') : t('Mostrar contraseña', 'Show password')}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <i className={showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                </button>
                            </div>
                        </div>

                        <button type="submit" className="btn btn-ipn w-100 py-3 mb-3 shadow-sm" disabled={isSubmitting}>
                            {isSubmitting ? (
                                t('Entrando...', 'Signing in...')
                            ) : (
                                <>
                                    {t('Ingresar', 'Sign in')} <i className="fas fa-shield-halved ms-2"></i>
                                </>
                            )}
                        </button>
                        {sinConfirmar && (
                            <div className="alert alert-warning small mt-2 mb-3" role="alert">
                                <p className="fw-bold mb-1">
                                    <i className="fas fa-envelope-open-text me-2" />
                                    {t('Confirma tu correo', 'Confirm your email')}
                                </p>
                                <p className="mb-3">{sinConfirmar}</p>
                                <ReenviarConfirmacion usuario={username} password={password} className="w-100" />
                            </div>
                        )}
                    </form>

                    <div className="text-center mt-4">
                        <p className="small text-muted mb-0">{t('¿Primera vez?', 'First time?')}</p>
                        <Link to="/register" className="text-decoration-none fw-bold small" style={{ color: 'var(--escom-blue)' }}>
                            {t('Crear una Cuenta', 'Create an Account')}
                        </Link>
                    </div>
                </div>

                <div className="bg-light p-3 text-center border-top">
                    <Link to="/" className="text-decoration-none small fw-bold" style={{ color: 'var(--ipn-maroon)' }}>
                        <i className="fas fa-arrow-left me-1"></i> {t('Regresar', 'Back')}
                    </Link>
                </div>
            </div>
        </div>
    );
}