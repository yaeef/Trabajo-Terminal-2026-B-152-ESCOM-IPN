import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { authService } from '../../services/auth.service';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
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
        const t = window.setTimeout(() => setEspera((s) => s - 1), 1000);
        return () => window.clearTimeout(t);
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
                notifyWarning(getApiErrorMessage(e, 'Espera un momento antes de pedir otro.'), 'Espera un momento');
                return;
            }
            notifyError(getApiErrorMessage(e, 'No se pudo reenviar el correo de verificación.'));
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
                ? 'Enviando…'
                : espera > 0
                  ? `Reenviar correo en ${minutos}:${segundos}`
                  : 'Reenviar correo de verificación'}
        </button>
    );
}
