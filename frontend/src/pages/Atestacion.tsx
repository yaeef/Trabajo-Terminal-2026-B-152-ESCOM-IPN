import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { atestacionService } from '../services/atestacion.service';
import type { AtestacionBovedaCandidata, AtestacionContexto, SentidoAtestacion } from '../types/dms.types';
import { decodeShareFile, verifyShare, type Share } from '../crypto/sss';
import { wipe } from '../crypto/sensitiveMemory';
import { useNotice } from '../store/NoticeContext';
import { getApiErrorMessage } from '../utils/errors';
import './auth/AuthTheme.css';
import './Recuperacion.css';
import KleimosLogo from '../components/brand/KleimosLogo';
import LanguageToggle from '../components/common/LanguageToggle';
import { getLang, t } from '../i18n';

/**
 * Página PÚBLICA (sin sesión). El custodio llega desde el enlace del correo del
 * Interruptor de Hombre Muerto (FRONTEND_DMS_VOTO_URL?token=...) y declara si el
 * titular sigue con vida o ha fallecido. Su voto suma al quórum global.
 *
 * Para que el voto sea válido, el custodio primero debe aportar un fragmento
 * .sss propio y que valide con Feldman VSS EN EL NAVEGADOR contra los
 * compromisos públicos de alguna bóveda donde tenga un fragmento asignado
 * (mismo mecanismo que el portal de recuperación real, ver Recuperacion.tsx) —
 * el servidor nunca ve el valor secreto `y`, solo la coordenada `x` (pública)
 * que usa para confirmar que corresponde al custodio del token.
 */
export default function Atestacion() {
    const [sp] = useSearchParams();
    const token = sp.get('token') ?? '';

    const [fase, setFase] = useState<'cargando' | 'formulario' | 'enviando' | 'hecho' | 'error'>(
        'cargando',
    );
    const [ctx, setCtx] = useState<AtestacionContexto | null>(null);
    const [seleccion, setSeleccion] = useState<SentidoAtestacion | null>(null);
    const [mensaje, setMensaje] = useState('');

    // Fragmento aportado para validar el voto: solo se conserva la x (pública)
    // y la bóveda que reconoció el fragmento — el valor secreto `y` se borra
    // en cuanto cumple su propósito de validación local, nunca se envía.
    const [validandoFrag, setValidandoFrag] = useState(false);
    const [xValidado, setXValidado] = useState<number | null>(null);
    const [bovedaValidada, setBovedaValidada] = useState<AtestacionBovedaCandidata | null>(null);
    const { notifyError } = useNotice();

    useEffect(() => {
        if (!token) {
            setFase('error');
            setMensaje(t('Este enlace no es válido. Ábrelo de nuevo desde tu correo.', 'This link is not valid. Open it again from your email.'));
            return;
        }
        atestacionService
            .getContexto(token)
            .then((data) => {
                setCtx(data);
                setFase('formulario');
            })
            .catch((err) => {
                setFase('error');
                setMensaje(getApiErrorMessage(err, t('No se pudo abrir la atestación.', "Couldn't open the attestation.")));
            });
    }, [token]);

    const onFile = async (file: File | undefined) => {
        if (!file || !ctx) return;
        setValidandoFrag(true);
        setXValidado(null);
        setBovedaValidada(null);

        let s: Share | null = null;
        try {
            const text = await file.text();
            s = await decodeShareFile(text);
            if (!ctx.bovedas.length) {
                throw new Error(t('No hay bóvedas activas asociadas a tu enlace en este momento.', 'There are no active vaults linked to your link right now.'));
            }
            let encontrada: AtestacionBovedaCandidata | null = null;
            for (const cand of ctx.bovedas) {
                const ok = await verifyShare(s, cand.commitments_hex);
                if (ok && cand.x_coords.includes(s.id)) {
                    encontrada = cand;
                    break;
                }
            }
            if (!encontrada) {
                throw new Error(
                    t(
                        'El fragmento no corresponde a ninguna de tus bóvedas. Revisa que sea el archivo correcto.',
                        "The share doesn't match any of your vaults. Make sure it's the right file.",
                    ),
                );
            }
            setXValidado(s.id);
            setBovedaValidada(encontrada);
        } catch (e) {
            notifyError(e instanceof Error ? e.message : t('No se pudo leer/validar el fragmento.', "Couldn't read/validate the share."));
        } finally {
            // El voto solo necesita la x (pública); el secreto ya cumplió su
            // propósito de validación local y no hace falta retenerlo más.
            wipe(s?.y);
            setValidandoFrag(false);
        }
    };

    const enviar = async () => {
        if (!seleccion || !bovedaValidada || xValidado === null) return;
        setFase('enviando');
        try {
            await atestacionService.votar(token, seleccion, bovedaValidada.pid, xValidado);
            setFase('hecho');
        } catch (err) {
            setFase('error');
            setMensaje(getApiErrorMessage(err, t('No se pudo registrar tu respuesta.', "Couldn't record your answer.")));
        }
    };

    const titular = ctx?.propietario_nombre ?? t('el titular', 'the account holder');

    return (
        <div className="auth-page">
            <div className="auth-theme-toggle">
                <LanguageToggle />
            </div>
            <div className="card-auth animate__animated animate__fadeInUp">
                <div className="top-gradient" />
                <div className="card-body p-4 p-md-5">
                    <div className="auth-logo">
                        <KleimosLogo tamano="md" />
                    </div>
                    {fase === 'cargando' && (
                        <div className="text-center">
                            <i className="fas fa-spinner fa-spin fa-2x text-muted" />
                            <p className="text-muted mt-3 mb-0">{t('Cargando…', 'Loading…')}</p>
                        </div>
                    )}

                    {fase === 'error' && (
                        <div className="text-center">
                            <div className="error-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-link-slash fa-3x" />
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                {t('No se pudo continuar', "Couldn't continue")}
                            </h3>
                            <p className="text-muted">{mensaje}</p>
                            <Link to="/" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                {t('Volver al inicio', 'Back to home')}
                            </Link>
                        </div>
                    )}

                    {fase === 'hecho' && (
                        <div className="text-center">
                            <div className="success-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-check fa-3x" />
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                {t('Respuesta registrada', 'Answer recorded')}
                            </h3>
                            {getLang() === 'es' ? (
                                <p className="text-muted">
                                    Gracias. Tu testimonio sobre <strong>{titular}</strong> quedó registrado y se
                                    tomará en cuenta junto con el de los demás custodios.
                                </p>
                            ) : (
                                <p className="text-muted">
                                    Thank you. Your statement about <strong>{titular}</strong> was recorded and will be
                                    taken into account along with the other custodians'.
                                </p>
                            )}
                            <Link to="/" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                {t('Entendido', 'Got it')}
                            </Link>
                        </div>
                    )}

                    {fase === 'formulario' && ctx && ctx.ya_voto && (
                        <div className="text-center">
                            <div className="success-icon-circle animate__animated animate__bounceIn">
                                <i className="fas fa-check fa-3x" />
                            </div>
                            <h3 className="fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                {t('Ya respondiste', 'You already answered')}
                            </h3>
                            {getLang() === 'es' ? (
                                <p className="text-muted">
                                    Registraste que <strong>{titular}</strong>{' '}
                                    {ctx.sentido === 'vida' ? 'sigue con vida' : 'ha fallecido'}. No necesitas
                                    hacer nada más.
                                </p>
                            ) : (
                                <p className="text-muted">
                                    You stated that <strong>{titular}</strong>{' '}
                                    {ctx.sentido === 'vida' ? 'is still alive' : 'has passed away'}. You don't need
                                    to do anything else.
                                </p>
                            )}
                            <Link to="/" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                {t('Entendido', 'Got it')}
                            </Link>
                        </div>
                    )}

                    {fase === 'formulario' && ctx && !ctx.ya_voto && !ctx.vigente && (
                        <div className="text-center">
                            <div className="d-inline-block p-3 rounded-circle bg-light shadow-sm">
                                <i className="fas fa-hourglass-end fa-3x" style={{ color: 'var(--escom-blue)' }} />
                            </div>
                            <h3 className="fw-bold mt-3" style={{ color: 'var(--escom-blue)' }}>
                                {t('La votación no está abierta', 'Voting is not open')}
                            </h3>
                            <p className="text-muted">
                                {t('Este enlace ya no admite respuestas: el titular confirmó su actividad, el proceso avanzó, o se abrió una ronda nueva. Si aplica, recibirás un correo con un enlace vigente.', "This link no longer accepts answers: the account holder confirmed activity, the process moved forward, or a new round was opened. If applicable, you'll receive an email with a valid link.")}
                            </p>
                            <Link to="/" className="btn btn-ipn w-100 mt-3 py-3 shadow-sm">
                                {t('Volver al inicio', 'Back to home')}
                            </Link>
                        </div>
                    )}

                    {(fase === 'formulario' || fase === 'enviando') &&
                        ctx &&
                        !ctx.ya_voto &&
                        ctx.vigente && (
                            <>
                                <div className="text-center mb-4">
                                    <div className="d-inline-block p-3 rounded-circle bg-light shadow-sm">
                                        <i
                                            className="fas fa-user-shield fa-3x"
                                            style={{ color: 'var(--escom-blue)' }}
                                        />
                                    </div>
                                    <h3 className="fw-bold mt-3 mb-2" style={{ color: 'var(--escom-blue)' }}>
                                        {t(`¿${titular} sigue con vida?`, `Is ${titular} still alive?`)}
                                    </h3>
                                    {getLang() === 'es' ? (
                                        <p className="text-muted small mb-0">
                                            Te designaron como custodio de <strong>{titular}</strong>. Hace tiempo que
                                            no da señales de vida. Responde según lo que sepas; si no tienes
                                            información, cierra esta página sin responder.
                                        </p>
                                    ) : (
                                        <p className="text-muted small mb-0">
                                            You were named a custodian of <strong>{titular}</strong>. They haven't shown
                                            any sign of life for a while. Answer based on what you know; if you have no
                                            information, close this page without answering.
                                        </p>
                                    )}
                                </div>

                                {!bovedaValidada && (
                                    <>
                                        <label className="recuperacion-label d-block mb-1">
                                            {t('Tu fragmento (.sss)', 'Your share (.sss)')}
                                        </label>
                                        <label
                                            className={`recuperacion-dropzone d-block mb-3 ${
                                                validandoFrag ? 'is-busy' : ''
                                            }`}
                                        >
                                            <input
                                                type="file"
                                                accept=".sss,text/plain"
                                                hidden
                                                disabled={validandoFrag}
                                                onChange={(e) => onFile(e.target.files?.[0])}
                                            />
                                            {validandoFrag ? (
                                                <>
                                                    <i className="fas fa-sync fa-spin mb-2" />
                                                    <p className="m-0 small fw-bold">{t('Validando fragmento…', 'Validating share…')}</p>
                                                </>
                                            ) : (
                                                <>
                                                    <i className="fas fa-key mb-2" />
                                                    <p className="m-0 small fw-bold">{t('Selecciona tu fragmento', 'Select your share')}</p>
                                                    <p className="m-0 small text-muted">
                                                        {t('Para que tu voto sea válido debes aportar tu fragmento asignado. Se revisa aquí mismo y nunca sale de tu navegador.', 'For your vote to count you must provide your assigned share. It is checked right here and never leaves your browser.')}
                                                    </p>
                                                </>
                                            )}
                                        </label>
                                    </>
                                )}

                                {bovedaValidada && (
                                    <div className="recuperacion-status mb-3">
                                        <small className="fw-bold text-success">
                                            <i className="fas fa-check-circle me-1" /> {t('Fragmento válido reconocido', 'Valid share recognized')}{' '}
                                            ({bovedaValidada.nombre}).
                                        </small>
                                    </div>
                                )}

                                <div className="d-grid gap-2 mb-3">
                                    <button
                                        type="button"
                                        className={`btn py-3 fw-semibold ${
                                            seleccion === 'vida'
                                                ? 'btn-success'
                                                : 'btn-outline-success'
                                        }`}
                                        onClick={() => setSeleccion('vida')}
                                        disabled={fase === 'enviando' || !bovedaValidada}
                                    >
                                        <i className="fas fa-heart-pulse me-2" />
                                        {t('Sé que sigue con vida', 'I know they are still alive')}
                                    </button>
                                    <button
                                        type="button"
                                        className={`btn py-3 fw-semibold ${
                                            seleccion === 'fallecimiento'
                                                ? 'btn-danger'
                                                : 'btn-outline-danger'
                                        }`}
                                        onClick={() => setSeleccion('fallecimiento')}
                                        disabled={fase === 'enviando' || !bovedaValidada}
                                    >
                                        <i className="fas fa-dove me-2" />
                                        {t('Me consta que ha fallecido', 'I know for a fact they have passed away')}
                                    </button>
                                </div>

                                {seleccion === 'fallecimiento' && (
                                    <div className="alert alert-warning py-2 small" role="alert">
                                        {t('Confirmar el fallecimiento acelera el proceso de recuperación del patrimonio. Hazlo solo si te consta.', 'Confirming the death speeds up the estate recovery process. Only do it if you know for a fact.')}
                                    </div>
                                )}

                                <button
                                    type="button"
                                    className="btn btn-ipn w-100 py-3 shadow-sm"
                                    onClick={enviar}
                                    disabled={!seleccion || !bovedaValidada || fase === 'enviando'}
                                >
                                    {fase === 'enviando' ? t('Enviando…', 'Sending…') : t('Enviar respuesta', 'Send answer')}
                                </button>
                            </>
                        )}
                </div>
            </div>
        </div>
    );
}
