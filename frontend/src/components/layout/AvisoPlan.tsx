import { Link } from 'react-router-dom';
import type { SuscripcionActiva } from '../../types/auth.types';
import { fechaCorta } from '../../types/subscription.types';
import { getLang } from '../../i18n';

/**
 * Aviso fijo en toda la app cuando el plan de pago venció: en la gracia (aún
 * puede renovar sin gastar su año de reserva) o con contenido que excede el
 * Gratuito y fecha de recorte. Los datos vienen de /me (suscripcion_activa).
 */
export default function AvisoPlan({ suscripcion }: { suscripcion: SuscripcionActiva | null | undefined }) {
    if (!suscripcion) return null;
    const es = getLang() === 'es';

    if (suscripcion.impago_recorte_en) {
        return (
            <div className="aviso-plan is-peligro" role="alert">
                <i className="fas fa-triangle-exclamation" />
                {es ? (
                    <span>
                        Tu plan terminó y tu cuenta está en solo lectura. El{' '}
                        <strong>{fechaCorta(suscripcion.impago_recorte_en)}</strong> se eliminará lo que excede el plan
                        Gratuito.
                    </span>
                ) : (
                    <span>
                        Your plan ended and your account is read-only. On{' '}
                        <strong>{fechaCorta(suscripcion.impago_recorte_en)}</strong> anything beyond the Free plan will
                        be deleted.
                    </span>
                )}
                <Link to="/suscripcion">{es ? 'Renovar o elegir qué conservar' : 'Renew or choose what to keep'}</Link>
            </div>
        );
    }
    if (suscripcion.origen === 'gracia' && suscripcion.fecha_fin) {
        return (
            <div className="aviso-plan" role="status">
                <i className="fas fa-hourglass-half" />
                {es ? (
                    <span>
                        Tu plan venció. Renueva antes del <strong>{fechaCorta(suscripcion.fecha_fin)}</strong> para no
                        empezar a usar tu año de reserva.
                    </span>
                ) : (
                    <span>
                        Your plan expired. Renew before <strong>{fechaCorta(suscripcion.fecha_fin)}</strong> to avoid
                        starting to use your reserve year.
                    </span>
                )}
                <Link to="/suscripcion">{es ? 'Renovar' : 'Renew'}</Link>
            </div>
        );
    }
    return null;
}
