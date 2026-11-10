import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { custodiosService } from '../services/custodios.service';
import { getApiErrorMessage } from '../utils/errors';
import './auth/AuthTheme.css';
import KleimosLogo from '../components/brand/KleimosLogo';

/**
 * CU-011 (paso 2): el custodio llega desde el link del correo
 * (FRONTEND_CONFIRM_CUSTODIO_URL?token=...). Sin sesión, igual que
 * ConfirmarCorreoSecundario.
 */
export default function ConfirmarCustodio() {
    const [sp] = useSearchParams();
    const token = sp.get('token') ?? '';
    const [estado, setEstado] = useState<'cargando' | 'exito' | 'error'>('cargando');
    const [mensaje, setMensaje] = useState('');

    useEffect(() => {
        if (!token) {
            setEstado('error');
            setMensaje('Este enlace no incluye un token válido.');
            return;
        }
        custodiosService
            .confirmChannel(token)
            .then(() => setEstado('exito'))
            .catch((err) => {
                setEstado('error');
                setMensaje(getApiErrorMessage(err, 'No se pudo confirmar el canal.'));
            });
    }, [token]);

    return (
        <div className="auth-page">
            <div className="card-auth animate__animated animate__fadeInUp">
                <div className="top-gradient" />
                <div className="card-body p-4 p-md-5 text-center">
                    <div className="auth-logo">
                        <KleimosLogo tamano="md" />
                    </div>
                    {estado === 'cargando' && (
                        <>
                            <div className="d-inline-block p-3 rounded-circle bg-light shadow-sm">
                                <i className="fas fa-shield-halved fa-3x" style={{ color: 'var(--escom-blue)' }} />
                            </div>
                            <h3 className="fw-bold mt-3" style={{ color: 'var(--escom-blue)' }}>Confirmando…</h3>
                            <p className="text-muted">Un momento por favor.</p>
                        </>
                    )}
                    {estado === 'exito' && (
                        <>
                            <div className="success-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-check fa-3x" />
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>Custodio confirmado</h3>
                            <p className="text-muted">
                                Quedaste registrado como custodio de confianza. Recibirás instrucciones si algún día se
                                activa un proceso de recuperación.
                            </p>
                            <Link to="/" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                Entendido
                            </Link>
                        </>
                    )}
                    {estado === 'error' && (
                        <>
                            <div className="error-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-link-slash fa-3x" />
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>Enlace inválido</h3>
                            <p className="text-muted">{mensaje}</p>
                            <Link to="/" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                Volver al inicio
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
