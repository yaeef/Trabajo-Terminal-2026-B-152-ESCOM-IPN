import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { authService } from '../../services/auth.service';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import { t } from '../../i18n';
import './ReenviarConfirmacion.css';

interface Props {
    usuario: string; // username o correo, como en el login
    password: string;
    /** Segundos antes de poder pedir otro (p. ej. recién registrado). */
    esperaInicial?: number;
    className?: string;
}

/** Botón «Reenviar correo de verificación» con cuenta regresiva entre envíos. */
export default function ReenviarConfirmacion({ usuario, password, esperaInicial = 0, className = '' }: Props) {
    const { notifySuccess, notifyWarning, notifyError } = useNotice();
    const [espera, setEspera] = useState(esperaInicial);
    const [enviando, setEnviando] = useState(false);

    useEffect(() => {
        if (espera <= 0) return;
        const id = window.setTimeout(() => setEspera((s) => s - 1), 1000);
        return () => window.clearTimeout(id);
    }, [espera]);

    const reenviar = async () => {
        setEnviando(true);
        try {
            const r = await authService.resendConfirmation(usuario, password);
            notifySuccess(r.detail);
            setEspera(r.espera_segundos);
        } catch (e) {
            if (isAxiosError(e) && e.response?.status === 429) {
                const cuerpo = e.response.data as { espera_segundos?: number } | undefined;
                const retry = Number(cuerpo?.espera_segundos ?? e.response.headers['retry-after']);
                if (retry > 0) setEspera(retry);
                notifyWarning(
                    getApiErrorMessage(e, t('Espera un momento antes de pedir otro.', 'Please wait a moment before requesting another one.')),
                    t('Espera un momento', 'Please wait'),
                );
                return;
            }
            notifyError(getApiErrorMessage(e, t('No se pudo reenviar el correo de verificación.', "Couldn't resend the verification email.")));
        } finally {
            setEnviando(false);
        }
    };

    const minutos = Math.floor(espera / 60);
    const segundos = String(espera % 60).padStart(2, '0');
    return (
        <button
            type="button"
            className={`btn btn-reenviar rounded-pill ${className}`}
            onClick={reenviar}
            disabled={enviando || espera > 0 || !usuario || !password}
        >
            <i className="fas fa-envelope me-2" />
            {enviando
                ? t('Enviando…', 'Sending…')
                : espera > 0
                  ? t(`Reenviar correo en ${minutos}:${segundos}`, `Resend email in ${minutos}:${segundos}`)
                  : t('Reenviar correo de verificación', 'Resend verification email')}
        </button>
    );
}
