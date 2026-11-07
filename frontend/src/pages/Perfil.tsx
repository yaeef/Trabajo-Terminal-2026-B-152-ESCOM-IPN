import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import { useAuth } from '../store/AuthContext';
import { useNotice } from '../store/NoticeContext';
import { userService } from '../services/user.service';
import { getApiErrorMessage } from '../utils/errors';
import './Perfil.css';

// Tiempo antes de redirigir a /configuracion tras un guardado exitoso,
// igual que el boceto aprobado (3s).
const SUCCESS_REDIRECT_MS = 3000;

export default function Perfil() {
    const { user, refreshUser } = useAuth();
    const { notifyError } = useNotice();
    const navigate = useNavigate();

    const [nombre, setNombre] = useState('');
    const [paterno, setPaterno] = useState('');
    const [materno, setMaterno] = useState('');

    const [passwordActual, setPasswordActual] = useState('');
    const [nuevaPassword, setNuevaPassword] = useState('');
    const [confirmarPassword, setConfirmarPassword] = useState('');
    const [showPasswordActual, setShowPasswordActual] = useState(false);
    const [showNuevaPassword, setShowNuevaPassword] = useState(false);
    const [showConfirmarPassword, setShowConfirmarPassword] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [barCollapsed, setBarCollapsed] = useState(false);

    // Precarga el formulario con los datos actuales del usuario en sesión.
    useEffect(() => {
        if (user) {
            setNombre(user.nombre ?? '');
            setPaterno(user.paterno ?? '');
            setMaterno(user.materno ?? '');
        }
    }, [user]);

    const quierecambiarPassword = passwordActual !== '' || nuevaPassword !== '' || confirmarPassword !== '';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (quierecambiarPassword) {
            if (!passwordActual || !nuevaPassword || !confirmarPassword) {
                notifyError('Completa los 3 campos de contraseña, o déjalos todos en blanco si no deseas cambiarla.');
                return;
            }
            if (nuevaPassword !== confirmarPassword) {
                notifyError('La confirmación no coincide con la nueva contraseña.');
                return;
            }
        }

        setIsSubmitting(true);
        try {
            await userService.updateProfile({
                nombre,
                paterno: paterno || undefined,
                materno: materno || undefined,
            });

            if (quierecambiarPassword) {
                await userService.changePassword({
                    password_actual: passwordActual,
                    nueva_password: nuevaPassword,
                    confirmar_password: confirmarPassword,
                });
            }

            await refreshUser();
            setPasswordActual('');
            setNuevaPassword('');
            setConfirmarPassword('');
            setShowSuccessModal(true);
        } catch (err) {
            notifyError(getApiErrorMessage(err, 'No se pudieron guardar los cambios.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    // Anima la barra del modal de éxito y redirige, igual que Register.tsx.
    useEffect(() => {
        if (!showSuccessModal) return;
        const collapseTimer = setTimeout(() => setBarCollapsed(true), 100);
        const redirectTimer = setTimeout(() => navigate('/configuracion'), SUCCESS_REDIRECT_MS);
        return () => {
            clearTimeout(collapseTimer);
            clearTimeout(redirectTimer);
        };
    }, [showSuccessModal, navigate]);

    return (
        <DashboardLayout activeItem="configuracion" topBarLabel="Gestión de Identidad" backTo="/configuracion">
            <div className="mb-5">
                <h2 className="fw-bold mb-1">Editar Perfil</h2>
                <p className="text-muted">Actualiza tu información personal y credenciales de acceso.</p>
            </div>

            <div className="edit-card">
                <form onSubmit={handleSubmit}>
                    <div className="text-center profile-avatar-display">
                        <img
                            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
                                nombre || user?.username || 'Usuario'
                            )}&background=003366&color=fff`}
                            alt="Avatar"
                            className="mb-4"
                        />
                    </div>

                    <h5 className="fw-bold mb-4" style={{ color: 'var(--escom-blue)' }}>
                        Datos Personales
                    </h5>
                    <div className="row g-4 mb-5">
                        <div className="col-md-6">
                            <label className="form-label">Nombre(s)</label>
                            <input
                                type="text"
                                className="form-control shadow-none"
                                value={nombre}
                                onChange={(e) => setNombre(e.target.value)}
                                required
                            />
                        </div>
                        <div className="col-md-6">
                            <label className="form-label">Apellido Paterno</label>
                            <input
                                type="text"
                                className="form-control shadow-none"
                                value={paterno}
                                onChange={(e) => setPaterno(e.target.value)}
                            />
                        </div>
                        <div className="col-md-6">
                            <label className="form-label">Apellido Materno</label>
                            <input
                                type="text"
                                className="form-control shadow-none"
                                value={materno}
                                onChange={(e) => setMaterno(e.target.value)}
                            />
                        </div>
                    </div>

                    <h5 className="fw-bold mb-4" style={{ color: 'var(--escom-blue)' }}>
                        Seguridad de la Cuenta
                    </h5>
                    <div className="row g-4 mb-5">
                        <div className="col-md-6">
                            <label className="form-label">Contraseña Actual</label>
                            <div className="input-group">
                                <input
                                    type={showPasswordActual ? 'text' : 'password'}
                                    className="form-control shadow-none"
                                    placeholder="••••••••"
                                    value={passwordActual}
                                    onChange={(e) => setPasswordActual(e.target.value)}
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    className="input-group-text"
                                    onClick={() => setShowPasswordActual((prev) => !prev)}
                                    aria-label={showPasswordActual ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    title={showPasswordActual ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <i className={showPasswordActual ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                </button>
                            </div>
                        </div>
                        <div className="col-md-6">
                            <label className="form-label">Nueva Contraseña</label>
                            <div className="input-group">
                                <input
                                    type={showNuevaPassword ? 'text' : 'password'}
                                    className="form-control shadow-none"
                                    placeholder="Min 12, Mayús, minús, número, símbolo"
                                    value={nuevaPassword}
                                    onChange={(e) => setNuevaPassword(e.target.value)}
                                    autoComplete="new-password"
                                />
                                <button
                                    type="button"
                                    className="input-group-text"
                                    onClick={() => setShowNuevaPassword((prev) => !prev)}
                                    aria-label={showNuevaPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    title={showNuevaPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <i className={showNuevaPassword ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                </button>
                            </div>
                        </div>
                        <div className="col-md-6">
                            <label className="form-label">Confirmar Nueva Contraseña</label>
                            <div className="input-group">
                                <input
                                    type={showConfirmarPassword ? 'text' : 'password'}
                                    className="form-control shadow-none"
                                    placeholder="••••••••"
                                    value={confirmarPassword}
                                    onChange={(e) => setConfirmarPassword(e.target.value)}
                                    autoComplete="new-password"
                                />
                                <button
                                    type="button"
                                    className="input-group-text"
                                    onClick={() => setShowConfirmarPassword((prev) => !prev)}
                                    aria-label={showConfirmarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    title={showConfirmarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <i className={showConfirmarPassword ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                </button>
                            </div>
                        </div>
                        <div className="col-12">
                            <div className="p-3 rounded-4 bg-light small text-muted">
                                <i className="fas fa-info-circle me-1 text-primary"></i>
                                Deja los campos de contraseña en blanco si no deseas cambiarla.
                            </div>
                        </div>
                    </div>

                    <div className="d-flex gap-3 justify-content-end pt-4 border-top">
                        <button
                            type="button"
                            className="btn btn-light rounded-pill px-4"
                            onClick={() => navigate('/configuracion')}
                            disabled={isSubmitting}
                        >
                            Cancelar
                        </button>
                        <button type="submit" className="btn btn-ipn" disabled={isSubmitting}>
                            {isSubmitting ? 'Guardando...' : 'Guardar Cambios'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Modal de éxito */}
            {showSuccessModal && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg text-center">
                            <div className="modal-header-gradient"></div>
                            <div className="modal-body p-5">
                                <div className="success-icon-circle animate__animated animate__bounceIn">
                                    <i className="fas fa-check-double fa-3x"></i>
                                </div>
                                <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                    ¡Perfil Actualizado!
                                </h3>
                                <p className="text-muted">
                                    Los cambios se han guardado correctamente. Redirigiendo a configuración...
                                </p>
                            </div>
                            <div className="progress-timer" style={{ width: barCollapsed ? '0%' : '100%' }}></div>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}