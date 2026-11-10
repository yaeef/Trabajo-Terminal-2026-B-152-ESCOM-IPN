import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../../services/auth.service';
import './AuthTheme.css';
import KleimosLogo from '../../components/brand/KleimosLogo';

/**
 * CU-005 (paso 1): solicitar el enlace de recuperación de contraseña.
 * Distinto del portal de recuperación de bóveda (/recuperacion, CU-029+):
 * esto es solo el login tradicional, no toca la llave maestra ni Shamir.
 *
 * El backend responde SIEMPRE el mismo mensaje genérico (202), exista o no
 * el correo — no se debe intentar diferenciar el resultado en el frontend
 * para no romper la protección anti-enumeración.
 */
export default function ForgotPassword() {
    const [correo, setCorreo] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await authService.forgotPassword({ correo });
        } finally {
            // Se marca como enviado incluso si la petición falla a nivel red,
            // para no filtrar información. Errores de conexión reales son
            // poco frecuentes aquí y no ameritan distinguir el caso al usuario.
            setIsSubmitting(false);
            setSubmitted(true);
        }
    };

    if (submitted) {
        return (
            <div className="auth-page">
                <div className="card-auth animate__animated animate__fadeInUp">
                    <div className="top-gradient"></div>
                    <div className="card-body p-4 p-md-5 text-center">
                        <div className="auth-logo">
                            <KleimosLogo tamano="md" />
                        </div>
                        <div className="success-icon-circle animate__animated animate__bounceIn">
                            <i className="fas fa-envelope-open-text fa-3x"></i>
                        </div>
                        <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>Revisa tu correo</h3>
                        <p className="text-muted">
                            Si el correo existe en nuestro sistema, se enviaron instrucciones de
                            recuperación por correo y Telegram (si tienes uno vinculado).
                        </p>
                        <p className="small text-muted">El enlace expira en 30 minutos.</p>
                        <Link to="/login" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                            Volver al login <i className="fas fa-arrow-right ms-2"></i>
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-page">
            <div className="card-auth animate__animated animate__fadeInUp">
                <div className="top-gradient"></div>
                <div className="card-body p-4 p-md-5">
                    <div className="auth-logo">
                        <KleimosLogo tamano="md" />
                    </div>
                    <div className="text-center mb-4">
                        <div className="d-inline-block p-3 rounded-circle bg-light shadow-sm">
                            <i className="fas fa-key fa-3x" style={{ color: 'var(--escom-blue)' }}></i>
                        </div>
                        <h3 className="fw-bold mb-1 mt-3" style={{ color: 'var(--escom-blue)' }}>
                            Recuperar contraseña
                        </h3>
                        <p className="text-muted small">
                            Ingresa tu correo y te enviaremos un enlace para restablecerla.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit}>
                        <div className="mb-4">
                            <label className="form-label small fw-bold text-muted">Correo electrónico</label>
                            <div className="input-group">
                                <span className="input-group-text"><i className="fas fa-envelope"></i></span>
                                <input
                                    type="email"
                                    className="form-control shadow-none"
                                    placeholder="usuario@correo.com"
                                    value={correo}
                                    onChange={(e) => setCorreo(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <button type="submit" className="btn btn-ipn w-100 py-3 mb-3 shadow-sm" disabled={isSubmitting}>
                            {isSubmitting ? (
                                'Enviando...'
                            ) : (
                                <>Enviar enlace <i className="fas fa-paper-plane ms-2"></i></>
                            )}
                        </button>
                    </form>

                    <div className="text-center">
                        <Link to="/login" className="text-decoration-none fw-bold small" style={{ color: 'var(--escom-blue)' }}>
                            <i className="fas fa-arrow-left me-1"></i> Volver al login
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
