import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dmsService } from '../services/dms.service';
import { useAuth } from '../store/AuthContext';
import { useNotice } from '../store/NoticeContext';
import { getApiErrorMessage } from '../utils/errors';
import './PrimerPasoCustodios.css';
import './ProtocoloPrimerPaso.css';
import { t } from '../i18n';

// Mismos valores que Configuración y el backend (schemas/user.py, CHECK de propietario).
const UMBRAL_OPCIONES = [30, 45, 60];
const GRACIA_OPCIONES = [7, 14, 21];
// Aviso previo: settings.DMS_ALERTA_PORCENTAJE (0.75 del umbral).
const ALERTA_PORCENTAJE = 0.75;

interface Props {
    /** Custodios confirmados (para el paso 1 ya cumplido). */
    custodiosListos: string[];
    onListo: () => void;
    onVolver: () => void;
}

/** Antes de la primera bóveda: el propietario revisa y confirma su protocolo de vida. */
export default function ProtocoloPrimerPaso({ custodiosListos, onListo, onVolver }: Props) {
    const { user } = useAuth();
    const { notifyError } = useNotice();
    const [umbral, setUmbral] = useState(60);
    const [gracia, setGracia] = useState(7);
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {
        dmsService
            .getProtocoloVida()
            .then((p) => {
                if (p.periodicidad_prueba) setUmbral(p.periodicidad_prueba);
                if (p.periodicidad_periodo_gracia) setGracia(p.periodicidad_periodo_gracia);
            })
            .catch(() => undefined) // se quedan los valores por defecto; al guardar se valida
            .finally(() => setCargando(false));
    }, []);

    const guardar = async () => {
        setGuardando(true);
        try {
            await dmsService.updateProtocoloVida({ periodicidad_prueba: umbral, periodicidad_periodo_gracia: gracia });
            onListo();
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo guardar tu protocolo de vida.', "Couldn't save your life protocol.")));
        } finally {
            setGuardando(false);
        }
    };

    const diaAviso = Math.round(umbral * ALERTA_PORCENTAJE);
    const nombres = custodiosListos.join(', ').replace(/, ([^,]*)$/, t(' y $1', ' and $1'));

    return (
        <div className="primer-paso is-pagina config-card protocolo-paso">
            <h5 className="fw-bold mb-1">
                <i className="fas fa-heartbeat me-2" />
                {t('Segundo paso: confirma tu protocolo de vida', 'Second step: confirm your life protocol')}
            </h5>
            <p className="text-muted small mb-3">
                {t('Es lo que decide cuándo tus custodios pueden abrir la bóveda. Revísalo antes de guardar algo en ella.', 'It decides when your custodians can open the vault. Review it before storing anything in it.')}
            </p>

            <ol className="primer-paso-lista">
                <li className="is-hecho">
                    <span className="primer-paso-num"><i className="fas fa-check" /></span>
                    <span>
                        <strong>{t('Registra a tus custodios', 'Register your custodians')}</strong>
                        <span className="d-block text-muted small">{nombres ? t(`${nombres} ya confirmaron.`, `${nombres} already confirmed.`) : t('Listo.', 'Done.')}</span>
                    </span>
                </li>
                <li className="is-actual">
                    <span className="primer-paso-num">2</span>
                    <span>
                        <strong>{t('Confirma tu protocolo de vida', 'Confirm your life protocol')}</strong>
                        <span className="d-block text-muted small">{t('Estás aquí.', 'You are here.')}</span>
                    </span>
                </li>
                <li>
                    <span className="primer-paso-num">3</span>
                    <span>
                        <strong>{t('Crea tu bóveda', 'Create your vault')}</strong>
                        <span className="d-block text-muted small">{t('Se habilita al guardar este paso.', 'Unlocked once you save this step.')}</span>
                    </span>
                </li>
            </ol>

            <fieldset className="pv-grupo" disabled={cargando || guardando}>
                <legend>{t('¿Cada cuánto confirmas que sigues aquí?', 'How often do you confirm you are still here?')}</legend>
                <p className="text-muted small mb-2">{t('Cada vez que entras a Kleimos cuenta como confirmación.', 'Every time you sign in to Kleimos counts as a confirmation.')}</p>
                <div className="pv-opciones">
                    {UMBRAL_OPCIONES.map((d) => (
                        <label key={d} className={`pv-opcion ${umbral === d ? 'is-sel' : ''}`}>
                            <input type="radio" name="pv-umbral" checked={umbral === d} onChange={() => setUmbral(d)} />
                            {d} {t('días', 'days')}
                        </label>
                    ))}
                </div>
            </fieldset>

            <fieldset className="pv-grupo" disabled={cargando || guardando}>
                <legend>{t('Si no respondes, ¿cuántos días más esperamos antes de que tus custodios puedan abrir la bóveda?', 'If you don’t respond, how many more days do we wait before your custodians can open the vault?')}</legend>
                <div className="pv-opciones">
                    {GRACIA_OPCIONES.map((d) => (
                        <label key={d} className={`pv-opcion ${gracia === d ? 'is-sel' : ''}`}>
                            <input type="radio" name="pv-gracia" checked={gracia === d} onChange={() => setGracia(d)} />
                            {d} {t('días', 'days')}
                        </label>
                    ))}
                </div>
            </fieldset>

            <div className="pv-grupo">
                <span className="pv-titulo">{t('¿Por dónde te avisamos?', 'How should we reach you?')}</span>
                <div className="pv-opciones">
                    <span className="pv-canal is-ok">
                        <i className="fas fa-envelope" /> {t('Correo · confirmado', 'Email · confirmed')}
                    </span>
                    {user?.id_telegram ? (
                        <span className="pv-canal is-ok">
                            <i className="fab fa-telegram-plane" /> {t('Telegram · vinculado', 'Telegram · linked')}
                        </span>
                    ) : (
                        <Link className="pv-canal is-pendiente" to="/configuracion">
                            <i className="fab fa-telegram-plane" /> {t('Vincular Telegram (opcional)', 'Link Telegram (optional)')}
                        </Link>
                    )}
                </div>
            </div>

            <div className="pv-resumen">
                <span className="pv-titulo">{t('Así funcionaría si dejas de entrar', 'This is what happens if you stop signing in')}</span>
                <ol className="pv-linea">
                    <li>
                        <strong>{t('Día', 'Day')} {diaAviso}</strong>
                        <span>{t('Te escribimos para que confirmes que sigues aquí.', 'We message you to confirm you are still here.')}</span>
                    </li>
                    <li>
                        <strong>{t('Día', 'Day')} {umbral}</strong>
                        <span>{t('Preguntamos a tus custodios si sigues con vida y te seguimos avisando.', 'We ask your custodians whether you are alive and keep notifying you.')}</span>
                    </li>
                    <li>
                        <strong>{t('Día', 'Day')} {umbral + gracia}</strong>
                        <span>{t('Si nadie confirma que sigues aquí, tus custodios pueden abrir la bóveda.', 'If nobody confirms you are still here, your custodians can open the vault.')}</span>
                    </li>
                </ol>
                <span className="text-muted small">{t('Si entras en cualquier momento, todo vuelve a empezar desde cero.', 'If you sign in at any point, everything starts over from zero.')}</span>
            </div>

            <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                <span className="text-muted small">{t('Puedes cambiarlo cuando quieras en Configuración.', 'You can change it anytime in Settings.')}</span>
                <div className="d-flex gap-2">
                    <button type="button" className="btn btn-light rounded-pill px-4" onClick={onVolver} disabled={guardando}>
                        {t('Volver', 'Back')}
                    </button>
                    <button type="button" className="btn btn-ipn" onClick={guardar} disabled={cargando || guardando}>
                        {guardando ? t('Guardando…', 'Saving…') : t('Guardar y continuar', 'Save and continue')}
                    </button>
                </div>
            </div>
        </div>
    );
}
