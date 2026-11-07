import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { channelsService } from '../services/channels.service';
import { getApiErrorMessage } from '../utils/errors';
import './auth/AuthTheme.css';

/**
 * CU-016 (paso 2): confirma el correo secundario usando el token recibido
 * por email. Corresponde a FRONTEND_CONFIRM_EMAIL_URL en el backend
 * (?token=...) — sin sesión activa necesaria, igual que ResetPassword.tsx.
 */
export default function ConfirmarCorreoSecundario() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') ?? '';

    const [estado, setEstado] = useState<'cargando' | 'exito' | 'error'>('cargando');
    const [mensaje, setMensaje] = useState('');

    useEffect(() => {
        if (!token) {
            setEstado('error');
            setMensaje('Este enlace no incluye un token de confirmación válido.');
            return;
        }

        channelsService
            .confirmSecondaryEmail(token)
            .then(() => setEstado('exito'))
            .catch((err) => {
                setEstado('error');
                setMensaje(getApiErrorMessage(err, 'No se pudo confirmar el correo alternativo.'));
            });
    }, [token]);

    return (
        <div className="auth-page">
            <div className="card-auth animate__animated animate__fadeInUp">
                <div className="top-gradient"></div>
                <div className="card-body p-4 p-md-5 text-center">
                    {estado === 'cargando' && (
                        <>
                            <div className="d-inline-block p-3 rounded-circle bg-light shadow-sm">
                                <i className="fas fa-envelope-open-text fa-3x" style={{ color: 'var(--escom-blue)' }}></i>
                            </div>
                            <h3 className="fw-bold mt-3" style={{ color: 'var(--escom-blue)' }}>
                                Confirmando correo...
                            </h3>
                            <p className="text-muted">Un momento por favor.</p>
                        </>
                    )}

                    {estado === 'exito' && (
                        <>
                            <div className="success-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-check fa-3x"></i>
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                Correo alternativo confirmado
                            </h3>
                            <p className="text-muted">Ya puedes usarlo como canal de notificación para tu protocolo de vida.</p>
                            <Link to="/login" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                Ir al login <i className="fas fa-arrow-right ms-2"></i>
                            </Link>
                        </>
                    )}

                    {estado === 'error' && (
                        <>
                            <div className="error-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-link-slash fa-3x"></i>
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                Enlace inválido
                            </h3>
                            <p className="text-muted">{mensaje}</p>
                            <Link to="/login" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                Ir al login <i className="fas fa-arrow-right ms-2"></i>
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
