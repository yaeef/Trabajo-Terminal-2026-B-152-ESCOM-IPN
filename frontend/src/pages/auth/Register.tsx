import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authService } from '../../services/auth.service';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import type { RegisterPayload } from '../../types/auth.types';
import './Register.css';

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

        if (formData.password !== confirmPassword) {
            notifyError('Las contraseñas no coinciden.');
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
            notifyError(getApiErrorMessage(err, 'Error en el registro'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="register-page">
            <div className="card-register animate__animated animate__fadeInUp">
                <div className="top-gradient"></div>

                <div className="card-body p-4 p-md-5">
                    <div className="text-center mb-5">
                        <h2 className="fw-bold mb-1" style={{ color: 'var(--escom-blue)' }}>Registro</h2>
                        <p className="text-muted">Crea una cuenta para gestionar tus bóvedas digitales</p>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* Sección: Datos Personales */}
                        <div className="section-title"><i className="fas fa-user me-2"></i> Datos Personales</div>
                        <div className="row g-3 mb-4">
                            <div className="col-md-4">
                                <label className="form-label small fw-bold text-muted">Nombre(s)</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Ej. Juan"
                                    value={formData.nombre}
                                    onChange={handleChange('nombre')}
                                    required
                                />
                            </div>
                            <div className="col-md-4">
                                <label className="form-label small fw-bold text-muted">Apellido Paterno</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Ej. Pérez (opcional)"
                                    value={formData.paterno}
                                    onChange={handleChange('paterno')}
                                />
                            </div>
                            <div className="col-md-4">
                                <label className="form-label small fw-bold text-muted">Apellido Materno</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Ej. García (opcional)"
                                    value={formData.materno}
                                    onChange={handleChange('materno')}
                                />
                            </div>
                            <div className="col-md-6">
                                <label className="form-label small fw-bold text-muted">Correo</label>
                                <div className="input-group">
                                    <span className="input-group-text"><i className="fas fa-envelope"></i></span>
                                    <input
                                        type="email"
                                        className="form-control"
                                        placeholder="usuario@correo.com"
                                        value={formData.correo}
                                        onChange={handleChange('correo')}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="col-md-6">
                                <label className="form-label small fw-bold text-muted">Username / Apodo</label>
                                <div className="input-group">
                                    <span className="input-group-text"><i className="fas fa-at"></i></span>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="nombre_usuario"
                                        value={formData.username}
                                        onChange={handleChange('username')}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Sección: Seguridad */}
                        <div className="section-title"><i className="fas fa-shield-alt me-2"></i> Seguridad</div>
                        <div className="row g-3 mb-4">
                            <div className="col-md-6">
                                <label className="form-label small fw-bold text-muted">Contraseña</label>
                                <div className="input-group">
                                    <span className="input-group-text"><i className="fas fa-lock"></i></span>
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        className="form-control"
                                        placeholder="Min 12, Mayús, minús, número, símbolo"
                                        value={formData.password}
                                        onChange={handleChange('password')}
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="input-group-text"
                                        onClick={() => setShowPassword((prev) => !prev)}
                                        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                        title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <i className={showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                    </button>
                                </div>
                            </div>
                            <div className="col-md-6">
                                <label className="form-label small fw-bold text-muted">Confirmar Contraseña</label>
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
                                        aria-label={showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                        title={showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <i className={showConfirmPassword ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <p className="small text-muted mb-4">
                          
                        </p>

                        <div className="text-center">
                            <button type="submit" className="btn btn-ipn shadow-lg mb-3" disabled={isSubmitting}>
                                {isSubmitting ? (
                                    'Registrando...'
                                ) : (
                                    <>Finalizar Registro <i className="fas fa-paper-plane ms-2"></i></>
                                )}
                            </button>
                            <p className="small text-muted">
                                ¿Ya tienes una cuenta?{' '}
                                <Link to="/login" className="text-decoration-none fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                    Inicia sesión aquí
                                </Link>
                            </p>
                        </div>
                    </form>
                </div>

                <div className="bg-light p-3 text-center border-top">
                    <Link to="/" className="text-decoration-none small fw-bold text-maroon">
                        <i className="fas fa-arrow-left me-1"></i> Regresar
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
                                <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>Confirma tu correo</h3>
                                <p className="text-muted">
                                    Tu cuenta fue creada. Te enviamos un enlace de confirmación a{' '}
                                    <strong>{formData.correo}</strong>; ábrelo para activarla y después inicia sesión.
                                </p>
                                <p className="small text-muted mb-0">
                                    El enlace vence en 24 horas. Si no lo encuentras, revisa la carpeta de spam o
                                    intenta iniciar sesión para recibir uno nuevo.
                                </p>
                                <button
                                    type="button"
                                    className="btn btn-ipn w-100 mt-4 py-3 shadow-sm"
                                    onClick={() => navigate('/login')}
                                >
                                    Ir a Iniciar Sesión <i className="fas fa-sign-in-alt ms-2"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
