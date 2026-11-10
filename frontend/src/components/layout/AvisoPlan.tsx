import { Link } from 'react-router-dom';
import type { SuscripcionActiva } from '../../types/auth.types';
import { fechaCorta } from '../../types/subscription.types';

/**
 * Aviso fijo en toda la app cuando el plan de pago venció: en la gracia (aún
 * puede renovar sin gastar su año de reserva) o con contenido que excede el
 * Gratuito y fecha de recorte. Los datos vienen de /me (suscripcion_activa).
 */
export default function AvisoPlan({ suscripcion }: { suscripcion: SuscripcionActiva | null | undefined }) {
    if (!suscripcion) return null;

    if (suscripcion.impago_recorte_en) {
        return (
            <div className="aviso-plan is-peligro" role="alert">
                <i className="fas fa-triangle-exclamation" />
                <span>
                    Tu plan terminó y tu cuenta está en solo lectura. El{' '}
                    <strong>{fechaCorta(suscripcion.impago_recorte_en)}</strong> se eliminará lo que excede el plan
                    Gratuito.
                </span>
                <Link to="/suscripcion">Renovar o elegir qué conservar</Link>
            </div>
        );
    }
    if (suscripcion.origen === 'gracia' && suscripcion.fecha_fin) {
        return (
            <div className="aviso-plan" role="status">
                <i className="fas fa-hourglass-half" />
                <span>
                    Tu plan venció. Renueva antes del <strong>{fechaCorta(suscripcion.fecha_fin)}</strong> para no
                    empezar a usar tu año de reserva.
                </span>
                <Link to="/suscripcion">Renovar</Link>
            </div>
        );
    }
    return null;
}
