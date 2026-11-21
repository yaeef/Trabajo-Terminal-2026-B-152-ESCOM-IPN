import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { channelsService } from '../services/channels.service';
import { getApiErrorMessage } from '../utils/errors';
import './auth/AuthTheme.css';
import KleimosLogo from '../components/brand/KleimosLogo';
import LanguageToggle from '../components/common/LanguageToggle';
import { t } from '../i18n';

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
            setMensaje(t('Este enlace no es válido. Ábrelo de nuevo desde tu correo.', 'This link is not valid. Open it again from your email.'));
            return;
        }

        channelsService
            .confirmSecondaryEmail(token)
            .then(() => setEstado('exito'))
            .catch((err) => {
                setEstado('error');
                setMensaje(getApiErrorMessage(err, t('No se pudo confirmar el correo alternativo.', "Couldn't confirm the alternate email.")));
            });
    }, [token]);

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
                    {estado === 'cargando' && (
                        <>
                            <div className="d-inline-block p-3 rounded-circle bg-light shadow-sm">
                                <i className="fas fa-envelope-open-text fa-3x" style={{ color: 'var(--escom-blue)' }}></i>
                            </div>
                            <h3 className="fw-bold mt-3" style={{ color: 'var(--escom-blue)' }}>
                                {t('Confirmando correo...', 'Confirming email...')}
                            </h3>
                            <p className="text-muted">{t('Un momento por favor.', 'One moment please.')}</p>
                        </>
                    )}

                    {estado === 'exito' && (
                        <>
                            <div className="success-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-check fa-3x"></i>
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                {t('Correo alternativo confirmado', 'Alternate email confirmed')}
                            </h3>
                            <p className="text-muted">{t('Ya puedes usarlo como canal de notificación para tu protocolo de vida.', 'You can now use it as a notification channel for your life protocol.')}</p>
                            <Link to="/login" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                {t('Ir al login', 'Go to sign in')} <i className="fas fa-arrow-right ms-2"></i>
                            </Link>
                        </>
                    )}

                    {estado === 'error' && (
                        <>
                            <div className="error-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-link-slash fa-3x"></i>
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                {t('Enlace inválido', 'Invalid link')}
                            </h3>
                            <p className="text-muted">{mensaje}</p>
                            <Link to="/login" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                {t('Ir al login', 'Go to sign in')} <i className="fas fa-arrow-right ms-2"></i>
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
