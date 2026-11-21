import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authService } from '../../services/auth.service';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import type { RegisterPayload } from '../../types/auth.types';
import RequisitosContrasena from '../../components/common/RequisitosContrasena';
import ReenviarConfirmacion from '../../components/common/ReenviarConfirmacion';
import { requisitoFaltante } from '../../utils/password';
import LanguageToggle from '../../components/common/LanguageToggle';
import { getLang, t } from '../../i18n';
import './Register.css';
import KleimosLogo from '../../components/brand/KleimosLogo';

const EMPTY_FORM: RegisterPayload = {
    username: '',
    nombre: '',
    paterno: '',
    materno: '',
    correo: '',
    password: '',
};

export default function Register() {
    const [formData, setFormData] = useState<RegisterPayload>(EMPTY_FORM);
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const navigate = useNavigate();
    const { notifyError } = useNotice();

    const handleChange = (field: keyof RegisterPayload) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData((prev) => ({ ...prev, [field]: e.target.value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const falta = requisitoFaltante(formData.password);
        if (falta) {
            notifyError(falta);
            return;
        }
        if (formData.password !== confirmPassword) {
            notifyError(t('Las contraseñas no coinciden.', "Passwords don't match."));
            return;
        }

        setIsSubmitting(true);
        try {
            const payload: RegisterPayload = {
                ...formData,
                paterno: formData.paterno || undefined,
                materno: formData.materno || undefined,
            };
            await authService.register(payload);
            // Sin autologin ni redirección: la cuenta no puede iniciar sesión
            // hasta confirmar el correo con el enlace que manda el backend.
            setShowSuccessModal(true);
        } catch (err) {
            notifyError(getApiErrorMessage(err, t('Error en el registro', 'Registration failed')));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="register-page">
            <div className="auth-theme-toggle">
                <LanguageToggle />
            </div>
            <div className="card-register animate__animated animate__fadeInUp">
                <div className="top-gradient"></div>

                <div className="card-body p-4 p-md-5">
                    <div className="auth-logo">
                        <KleimosLogo tamano="md" />
                    </div>
                    <div className="text-center mb-5">
                        <h2 className="fw-bold mb-1" style={{ color: 'var(--escom-blue)' }}>{t('Registro', 'Sign up')}</h2>
                        <p className="text-muted">{t('Crea una cuenta para gestionar tus bóvedas digitales', 'Create an account to manage your digital vaults')}</p>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* Sección: Datos Personales */}
                        <div className="section-title"><i className="fas fa-user me-2"></i> {t('Datos Personales', 'Personal Details')}</div>
                        <div className="row g-3 mb-4">
                            <div className="col-md-4">
                                <label className="form-label small fw-bold text-muted">{t('Nombre(s)', 'First name(s)')}</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder={t('Ej. Juan', 'e.g. John')}
                                    value={formData.nombre}
                                    onChange={handleChange('nombre')}
                                    required
                                />
                            </div>
                            <div className="col-md-4">
                                <label className="form-label small fw-bold text-muted">{t('Apellido Paterno', 'Paternal Surname')}</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder={t('Ej. Pérez (opcional)', 'e.g. Smith (optional)')}
                                    value={formData.paterno}
                                    onChange={handleChange('paterno')}
                                />
                            </div>
                            <div className="col-md-4">
                                <label className="form-label small fw-bold text-muted">{t('Apellido Materno', 'Maternal Surname')}</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder={t('Ej. García (opcional)', 'e.g. García (optional)')}
                                    value={formData.materno}
                                    onChange={handleChange('materno')}
                                />
                            </div>
                            <div className="col-md-6">
                                <label className="form-label small fw-bold text-muted">{t('Correo', 'Email')}</label>
                                <div className="input-group">
                                    <span className="input-group-text"><i className="fas fa-envelope"></i></span>
                                    <input
                                        type="email"
                                        className="form-control"
                                        placeholder={t('usuario@correo.com', 'user@email.com')}
                                        value={formData.correo}
                                        onChange={handleChange('correo')}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="col-md-6">
                                <label className="form-label small fw-bold text-muted">{t('Username / Apodo', 'Username / Nickname')}</label>
                                <div className="input-group">
                                    <span className="input-group-text"><i className="fas fa-at"></i></span>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder={t('nombre_usuario', 'user_name')}
                                        value={formData.username}
                                        onChange={handleChange('username')}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Sección: Seguridad */}
                        <div className="section-title"><i className="fas fa-shield-alt me-2"></i> {t('Seguridad', 'Security')}</div>
                        <div className="row g-3 mb-4">
                            <div className="col-md-6">
                                <label className="form-label small fw-bold text-muted">{t('Contraseña', 'Password')}</label>
                                <div className="input-group">
                                    <span className="input-group-text"><i className="fas fa-lock"></i></span>
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        className="form-control"
                                        placeholder={t('Mínimo 12 caracteres', 'At least 12 characters')}
                                        value={formData.password}
                                        onChange={handleChange('password')}
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
                            <div className="col-md-6">
                                <label className="form-label small fw-bold text-muted">{t('Confirmar Contraseña', 'Confirm Password')}</label>
                                <div className="input-group">
                                    <span className="input-group-text"><i className="fas fa-check-double"></i></span>
                                    <input
                                        type={showConfirmPassword ? 'text' : 'password'}
                                        className="form-control"
                                        placeholder="••••••••"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="input-group-text"
                                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                                        aria-label={showConfirmPassword ? t('Ocultar contraseña', 'Hide password') : t('Mostrar contraseña', 'Show password')}
                                        title={showConfirmPassword ? t('Ocultar contraseña', 'Hide password') : t('Mostrar contraseña', 'Show password')}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <i className={showConfirmPassword ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="mb-4">
                            <p className="small fw-bold text-muted mb-0">{t('Tu contraseña debe tener:', 'Your password must have:')}</p>
                            <RequisitosContrasena password={formData.password} confirmacion={confirmPassword} />
                        </div>

                        <div className="text-center">
                            <button type="submit" className="btn btn-ipn shadow-lg mb-3" disabled={isSubmitting}>
                                {isSubmitting ? (
                                    t('Registrando...', 'Signing up...')
                                ) : (
                                    <>{t('Finalizar Registro', 'Complete Sign-up')} <i className="fas fa-paper-plane ms-2"></i></>
                                )}
                            </button>
                            <p className="small text-muted">
                                {t('¿Ya tienes una cuenta?', 'Already have an account?')}{' '}
                                <Link to="/login" className="text-decoration-none fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                    {t('Inicia sesión aquí', 'Sign in here')}
                                </Link>
                            </p>
                        </div>
                    </form>
                </div>

                <div className="bg-light p-3 text-center border-top">
                    <Link to="/" className="text-decoration-none small fw-bold text-maroon">
                        <i className="fas fa-arrow-left me-1"></i> {t('Regresar', 'Back')}
                    </Link>
                </div>
            </div>

            {/* Modal de éxito, controlado por estado de React (sin depender del JS de Bootstrap) */}
            {showSuccessModal && (
                <div
                    className="modal fade show d-block"
                    tabIndex={-1}
                    style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
                >
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg text-center">
                            <div className="modal-header-gradient"></div>
                            <div className="modal-body p-5">
                                <div className="success-icon-circle animate__animated animate__bounceIn">
                                    <i className="fas fa-envelope-open-text fa-3x"></i>
                                </div>
                                <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>{t('Confirma tu correo', 'Confirm your email')}</h3>
                                {getLang() === 'es' ? (
                                    <p className="text-muted">
                                        Tu cuenta fue creada. Te enviamos un enlace de confirmación a{' '}
                                        <strong>{formData.correo}</strong>; ábrelo para activarla y después inicia sesión.
                                    </p>
                                ) : (
                                    <p className="text-muted">
                                        Your account was created. We sent a confirmation link to{' '}
                                        <strong>{formData.correo}</strong>; open it to activate your account, then sign in.
                                    </p>
                                )}
                                <p className="small text-muted mb-3">
                                    {t(
                                        'El enlace vence en 24 horas. Si no lo encuentras, revisa la carpeta de spam. Si no te llegó, pide otro (cada uno nuevo invalida el anterior).',
                                        "The link expires in 24 hours. If you can't find it, check your spam folder. If it didn't arrive, request another one (each new one invalidates the previous).",
                                    )}
                                </p>
                                <ReenviarConfirmacion
                                    usuario={formData.correo}
                                    password={formData.password}
                                    esperaInicial={120}
                                    className="w-100"
                                />
                                <button
                                    type="button"
                                    className="btn btn-ipn w-100 mt-4 py-3 shadow-sm"
                                    onClick={() => navigate('/login')}
                                >
                                    {t('Ir a Iniciar Sesión', 'Go to Sign In')} <i className="fas fa-sign-in-alt ms-2"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
