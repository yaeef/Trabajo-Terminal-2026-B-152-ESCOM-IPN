import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { custodiosService } from '../services/custodios.service';
import { getApiErrorMessage } from '../utils/errors';
import './auth/AuthTheme.css';
import KleimosLogo from '../components/brand/KleimosLogo';
import LanguageToggle from '../components/common/LanguageToggle';
import { t } from '../i18n';

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
            setMensaje(t('Este enlace no es válido. Ábrelo de nuevo desde tu correo.', 'This link is not valid. Open it again from your email.'));
            return;
        }
        custodiosService
            .confirmChannel(token)
            .then(() => setEstado('exito'))
            .catch((err) => {
                setEstado('error');
                setMensaje(getApiErrorMessage(err, t('No se pudo confirmar el canal.', "Couldn't confirm the channel.")));
            });
    }, [token]);

    return (
        <div className="auth-page">
            <div className="auth-theme-toggle">
                <LanguageToggle />
            </div>
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
                            <h3 className="fw-bold mt-3" style={{ color: 'var(--escom-blue)' }}>{t('Confirmando…', 'Confirming…')}</h3>
                            <p className="text-muted">{t('Un momento por favor.', 'One moment please.')}</p>
                        </>
                    )}
                    {estado === 'exito' && (
                        <>
                            <div className="success-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-check fa-3x" />
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>{t('Custodio confirmado', 'Custodian confirmed')}</h3>
                            <p className="text-muted">
                                {t(
                                    'Quedaste registrado como custodio de confianza. Recibirás instrucciones si algún día se activa un proceso de recuperación.',
                                    "You're now registered as a trusted custodian. You'll receive instructions if a recovery process is ever started.",
                                )}
                            </p>
                            <Link to="/" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                {t('Entendido', 'Got it')}
                            </Link>
                        </>
                    )}
                    {estado === 'error' && (
                        <>
                            <div className="error-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-link-slash fa-3x" />
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>{t('Enlace inválido', 'Invalid link')}</h3>
                            <p className="text-muted">{mensaje}</p>
                            <Link to="/" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                {t('Volver al inicio', 'Back to home')}
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
