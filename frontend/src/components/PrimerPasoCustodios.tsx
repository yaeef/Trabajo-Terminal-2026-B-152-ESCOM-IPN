import { useNavigate } from 'react-router-dom';
import { custodioNotificable, MIN_CUSTODIOS_BOVEDA } from '../types/custodios.types';
import './PrimerPasoCustodios.css';
import { getLang, t } from '../i18n';

/** Lo mínimo de un custodio (sirve con el directorio de Custodios o el de bóvedas). */
interface CustodioBasico {
    id: number;
    nombre: string;
    nombre_completo?: string;
    correo_verificado: boolean;
    telegram_verificado: boolean;
}

interface Props {
    custodios: CustodioBasico[];
    /** 'pagina': ocupa la pantalla de Nueva bóveda. 'aviso': recuadro dentro de otra pantalla. */
    variante?: 'pagina' | 'aviso';
}

/** Antes de crear una bóveda: al menos 3 custodios con correo o Telegram confirmado.
 *  No muestra nada si ya los tiene. */
export default function PrimerPasoCustodios({ custodios, variante = 'aviso' }: Props) {
    const navigate = useNavigate();
    const listos = custodios.filter(custodioNotificable);
    if (listos.length >= MIN_CUSTODIOS_BOVEDA) return null;

    const pendientes = custodios.filter((c) => !custodioNotificable(c));
    const faltanRegistrar = Math.max(MIN_CUSTODIOS_BOVEDA - custodios.length, 0);
    const pasos = [
        {
            hecho: custodios.length >= MIN_CUSTODIOS_BOVEDA,
            titulo: t(`Registra al menos ${MIN_CUSTODIOS_BOVEDA} custodios`, `Register at least ${MIN_CUSTODIOS_BOVEDA} custodians`),
            detalle:
                faltanRegistrar > 0
                    ? t(
                          `Llevas ${custodios.length}; te ${faltanRegistrar === 1 ? 'falta 1' : `faltan ${faltanRegistrar}`}.`,
                          `You have ${custodios.length}; ${faltanRegistrar} more to go.`,
                      )
                    : t(`Llevas ${custodios.length}.`, `You have ${custodios.length}.`),
        },
        {
            hecho: false,
            titulo: t('Espera a que confirmen su correo o su Telegram', 'Wait for them to confirm their email or Telegram'),
            detalle:
                t(`${listos.length} de ${MIN_CUSTODIOS_BOVEDA} confirmados.`, `${listos.length} of ${MIN_CUSTODIOS_BOVEDA} confirmed.`) +
                (pendientes.length > 0
                    ? t(' Esperando a: ', ' Waiting for: ') + `${pendientes.map((c) => c.nombre_completo || c.nombre).join(', ')}.`
                    : ''),
        },
        {
            hecho: false,
            titulo: t('Crea tu bóveda', 'Create your vault'),
            detalle: t('Se habilita en cuanto tengas los custodios confirmados.', 'Unlocked as soon as your custodians are confirmed.'),
        },
    ];

    return (
        <div className={`primer-paso ${variante === 'pagina' ? 'is-pagina config-card' : 'mb-4'}`}>
            <h5 className="fw-bold mb-1">
                <i className="fas fa-user-shield me-2" />
                {t('Primer paso: registra a tus custodios', 'First step: register your custodians')}
            </h5>
            <p className="text-muted small mb-3">
                {getLang() === 'es'
                    ? `Para crear una bóveda necesitas al menos ${MIN_CUSTODIOS_BOVEDA} custodios que hayan confirmado su correo o su Telegram. Ellos reciben los fragmentos de la llave de la bóveda y son quienes podrán recuperarla si a ti te pasa algo.`
                    : `To create a vault you need at least ${MIN_CUSTODIOS_BOVEDA} custodians who have confirmed their email or Telegram. They receive the shares of the vault key and are the ones who can recover it if something happens to you.`}
            </p>
            <ol className="primer-paso-lista">
                {pasos.map((p, i) => (
                    <li key={p.titulo} className={p.hecho ? 'is-hecho' : ''}>
                        <span className="primer-paso-num">{p.hecho ? <i className="fas fa-check" /> : i + 1}</span>
                        <span>
                            <strong>{p.titulo}</strong>
                            <span className="d-block text-muted small">{p.detalle}</span>
                        </span>
                    </li>
                ))}
            </ol>
            <div className="d-flex flex-wrap gap-2">
                <button className="btn btn-ipn" onClick={() => navigate('/custodios')}>
                    <i className="fas fa-user-plus me-2" />
                    {custodios.length === 0 ? t('Registrar custodios', 'Register custodians') : t('Ir a Custodios', 'Go to Custodians')}
                </button>
                {variante === 'pagina' && (
                    <button className="btn btn-light rounded-pill px-4" onClick={() => navigate('/bovedas')}>
                        {t('Volver', 'Back')}
                    </button>
                )}
            </div>
        </div>
    );
}
