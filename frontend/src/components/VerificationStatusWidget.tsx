import type { ProtocoloVidaResponse } from '../types/dms.types';
import { calcularProximaVerificacion, formatFechaCorta } from '../utils/dms';
import './VerificationStatusWidget.css';

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
                    <div className="verif-label">Protocolo de vida</div>
                    <p className="verif-date" style={{ fontSize: '0.85rem' }}>
                        Aún sin check-ins registrados
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
                <div className="verif-label">Próxima Verificación</div>
                <p className="verif-date">{formatFechaCorta(proxima.fecha)}</p>
            </div>
            <div className="verif-tag">{proxima.estado === 'ok' ? 'Al día' : 'Requiere atención'}</div>
        </div>
    );
}
