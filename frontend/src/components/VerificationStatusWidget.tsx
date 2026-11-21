import type { ProtocoloVidaResponse } from '../types/dms.types';
import { calcularProximaVerificacion, formatFechaCorta } from '../utils/dms';
import './VerificationStatusWidget.css';
import { t } from '../i18n';

interface VerificationStatusWidgetProps {
    protocoloVida: ProtocoloVidaResponse | null;
    loading: boolean;
}

/**
 * Muestra la próxima fecha de check-in calculada a partir de datos reales
 * de GET /propietario/protocolo-vida. No se renderiza nada mientras carga
 * ni si el usuario no tiene fila de propietario (ej. un admin).
 */
export default function VerificationStatusWidget({ protocoloVida, loading }: VerificationStatusWidgetProps) {
    if (loading || !protocoloVida) return null;

    const proxima = calcularProximaVerificacion(protocoloVida);

    if (!proxima.fecha) {
        return (
            <div className="verification-status">
                <div>
                    <div className="verif-label">{t('Protocolo de vida', 'Life protocol')}</div>
                    <p className="verif-date" style={{ fontSize: '0.85rem' }}>
                        {t('Aún sin check-ins registrados', 'No check-ins recorded yet')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="verification-status">
            <div className="status-indicator">
                <div className={`status-dot ${proxima.estado}`}></div>
                <div className={`status-pulse ${proxima.estado}`}></div>
            </div>
            <div>
                <div className="verif-label">{t('Próxima Verificación', 'Next Check-in')}</div>
                <p className="verif-date">{formatFechaCorta(proxima.fecha)}</p>
            </div>
            <div className="verif-tag">{proxima.estado === 'ok' ? t('Al día', 'Up to date') : t('Requiere atención', 'Needs attention')}</div>
        </div>
    );
}
