import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { recuperacionService } from '../services/recuperacion.service';
import { useNotice } from '../store/NoticeContext';
import { getApiErrorMessage } from '../utils/errors';
import { getTheme, toggleTheme } from '../theme';
import { decodeShareFile, verifyShare, type Share } from '../crypto/sss';
import { wipe } from '../crypto/sensitiveMemory';
import { downloadEmergencySheet } from '../crypto/emergencySheet';
import { deriveBpKeypair, bpKdfEnvelope, randomSaltHex, cifrarFragmento } from '../crypto/recuperacionCrypto';
import { suggestPassphrase, passphraseBits, passphraseMeter, MIN_PASSPHRASE_BITS } from '../crypto/vaultCrypto';
import { useRecuperacionSession } from '../store/RecuperacionSessionContext';
import { recordarNombre, nombreRecordado } from '../utils/recuperacionIdentidad';
import { PARENTESCO_OPCIONES, parentescoLabel } from '../types/custodios.types';
import { categoriaLabel } from '../types/bovedas.types';
import LanguageToggle from '../components/common/LanguageToggle';
import { getLang, t } from '../i18n';
import VistaPreviaSesion, { restanteDeSesion, useReloj } from './recuperacion/VistaPreviaSesion';
import type { BovedaRecuperacionResponse, SesionEstadoResponse } from '../types/recuperacion.types';
import './Recuperacion.css';
import KleimosLogo from '../components/brand/KleimosLogo';

/**
 * CU-029 a CU-032 — Portal público de recuperación:
 *   1. Localizar la bóveda por su PID (solo aparece si el DMS ya liberó el
 *      patrimonio; 404 idéntico para un PID inexistente que para uno que
 *      no califica).
 *   2. Aportar un fragmento .sss PRIMERO y validarlo con Feldman VSS EN EL
 *      NAVEGADOR contra los compromisos públicos de la bóveda — un
 *      fragmento inválido nunca llega a cifrarse ni a subirse.
 *   3. El sistema reconoce la coordenada x del fragmento contra la sesión
 *      vigente (si hay una) SIN pedirle a nadie que se auto-identifique:
 *        - x == x_fundador de la sesión  -> es el BP; solo se le pide la
 *          pass-phrase de sesión para reingresar.
 *        - x ya aparece entre los depósitos -> ya había entrado antes; se
 *          le deja pasar directo, sin repetir el formulario.
 *        - x nueva y ya hay sesión -> ANTES de aportar nada ve quién es el
 *          Beneficiario Principal, quiénes ya se unieron (custodio asignado
 *          a cada fragmento y nombre con el que se registró) y cuánto le
 *          queda a la sesión, y decide si se une; si no, su fragmento no
 *          sale del navegador.
 *        - x nueva y no hay sesión -> la funda como Beneficiario Principal
 *          (con una nueva pass-phrase).
 *
 * Mismo estilo de card/formulario que el login (Login.tsx / Login.css).
 */
export default function Recuperacion() {
    const { pid: pidParam } = useParams();
    const navigate = useNavigate();
    const [theme, setTheme] = useState(getTheme());
    const { setBp } = useRecuperacionSession();

    const [pidInput, setPidInput] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [boveda, setBoveda] = useState<BovedaRecuperacionResponse | null>(null);
    const [notFound, setNotFound] = useState(false);
    const { notifyError } = useNotice();

    // fragmento (siempre primero)
    const [share, setShare] = useState<Share | null>(null);
    const [validando, setValidando] = useState(false);
    const [sesion, setSesion] = useState<SesionEstadoResponse | null>(null);

    // solo para el caso "fragmento nuevo"
    const [nombreDeclarado, setNombreDeclarado] = useState('');
    const [vinculoDeclarado, setVinculoDeclarado] = useState(PARENTESCO_OPCIONES[0]);
    // passphrase: reingreso del BP reconocido, o nueva al fundar
    const [passphrase, setPassphrase] = useState('');
    // Mostrar/ocultar solo aplica al fundar (ahí tiene sentido revisar lo que
    // "Sugerir" acaba de escribir); al reingresar es un campo tipo login.
    const [showNuevaPass, setShowNuevaPass] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [aviso, setAviso] = useState('');

    const buscar = async (pid: string) => {
        const limpio = pid.trim();
        if (!limpio) return;
        setBuscando(true);
        setNotFound(false);
        try {
            const b = await recuperacionService.buscarBoveda(limpio);
            setBoveda(b);
            if (!pidParam) navigate(`/recuperacion/${encodeURIComponent(b.pid)}`, { replace: true });
        } catch (e) {
            const status = (e as { response?: { status?: number } })?.response?.status;
            if (status === 404) {
                setNotFound(true);
            } else {
                notifyError(getApiErrorMessage(e, t('No se pudo buscar la bóveda.', "Couldn't look up the vault.")));
            }
        } finally {
            setBuscando(false);
        }
    };

    useEffect(() => {
        if (pidParam) {
            setPidInput(pidParam);
            buscar(pidParam);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pidParam]);

    // limpia el fragmento en claro si se abandona la página a medias
    useEffect(() => () => wipe(share?.y), [share]);

    const reintentar = () => {
        setNotFound(false);
        if (pidParam) navigate('/recuperacion');
    };

    const buscarOtra = () => {
        wipe(share?.y);
        setBoveda(null);
        setPidInput('');
        setShare(null);
        setSesion(null);
        setPassphrase('');
        setShowNuevaPass(false);
        navigate('/recuperacion');
    };

    const onFile = async (file: File | undefined) => {
        if (!file || !boveda) return;
        setAviso('');
        setValidando(true);
        setShare(null);
        setSesion(null);

        // Paso 1: leer + validar VSS — 100% local, no toca la red.
        let validado: Share;
        try {
            const text = await file.text();
            const s = await decodeShareFile(text);
            if (!boveda.commitments_hex) {
                throw new Error(t('Esta bóveda todavía no está lista para recuperarse.', "This vault isn't ready to be recovered yet."));
            }
            const ok = await verifyShare(s, boveda.commitments_hex);
            if (!ok) {
                wipe(s.y);
                throw new Error(t('El fragmento no corresponde a esta bóveda. Revisa que sea el archivo correcto.', "The share doesn't match this vault. Make sure it's the right file."));
            }
            validado = s;
        } catch (e) {
            notifyError(e instanceof Error ? e.message : t('No se pudo leer/validar el fragmento.', "Couldn't read/validate the share."));
            setValidando(false);
            return;
        }

        // Paso 2: consultar la sesión — esto sí es red. Si falla, el fragmento
        // en sí ya era válido; que quede claro que el problema es de conexión,
        // no del archivo (para no hacer creer que hay que buscar otro .sss).
        try {
            const est = await recuperacionService.getSesion(boveda.pid);
            setShare(validado);
            setSesion(est);
        } catch (e) {
            wipe(validado.y);
            notifyError(
                getApiErrorMessage(
                    e,
                    t('Tu fragmento es válido, pero no se pudo conectar con el servidor para revisar la sesión. Verifica tu conexión e inténtalo de nuevo.', "Your share is valid, but we couldn't reach the server to check the session. Check your connection and try again."),
                ),
            );
        } finally {
            setValidando(false);
        }
    };

    const depositoExistente =
        share && sesion?.existe ? sesion.depositos.find((d) => d.x_fragmento === share.id) : undefined;
    const esFundador = !!share && !!sesion?.existe && sesion.x_fundador === share.id;
    const yaDepositado = !esFundador && !!depositoExistente;
    const esNuevo = !!share && !!sesion && !esFundador && !yaDepositado;
    // Unirse a una sesión existente: el custodio primero la revisa y decide.
    const revisandoSesion = esNuevo && !!sesion?.existe;
    const ahora = useReloj(revisandoSesion);
    const restanteMs = sesion?.existe ? restanteDeSesion(sesion, ahora) : Infinity;
    const sesionExpirada = revisandoSesion && restanteMs <= 0;

    const refrescarSesion = async () => {
        if (!boveda) return;
        try {
            setSesion(await recuperacionService.getSesion(boveda.pid));
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo volver a cargar la sesión.', "Couldn't reload the session.")));
        }
    };

    /** Decide no unirse: el fragmento se descarta y nunca se envía. */
    const noUnirme = () => {
        wipe(share?.y);
        setShare(null);
        setSesion(null);
        setAviso(t('No te uniste a la sesión: tu fragmento no se aportó ni salió de tu navegador. Puedes volver a subirlo cuando quieras.', "You didn't join the session: your share wasn't contributed and never left your browser. You can upload it again whenever you want."));
    };

    const entrarComoBP = async () => {
        if (!share || !boveda || !sesion?.bp_kdf_salt || !sesion.bp_public_key || !passphrase) return;
        setEnviando(true);
        try {
            const env = {
                algo: sesion.bp_kdf_algo || 'pbkdf2-sha256',
                salt: sesion.bp_kdf_salt,
                params: sesion.bp_kdf_params || {},
            };
            const { privateKey, publicKeyHex } = await deriveBpKeypair(passphrase, env);
            if (publicKeyHex !== sesion.bp_public_key) {
                wipe(privateKey);
                throw new Error(t('Clave de la sesión incorrecta.', 'Incorrect session key.'));
            }
            wipe(share.y);
            setBp({ pid: boveda.pid, privateKey, dek: null, nombreDeclarado: nombreRecordado(boveda.pid) });
            navigate(`/recuperacion/${boveda.pid}/bp`);
        } catch (e) {
            notifyError(e instanceof Error ? e.message : t('No se pudo entrar a la sesión.', "Couldn't enter the session."));
        } finally {
            setEnviando(false);
        }
    };

    const entrarComoCustodio = () => {
        if (!boveda || !depositoExistente) return;
        recordarNombre(boveda.pid, depositoExistente.nombre_declarado);
        wipe(share?.y);
        navigate(`/recuperacion/${boveda.pid}/custodio`);
    };

    const confirmarNuevo = async () => {
        if (!share || !boveda || !sesion) return;
        setEnviando(true);
        try {
            if (sesion.existe && sesion.bp_public_key) {
                // Cifrado para el BP que el custodio revisó; el servidor rechaza
                // el depósito si entretanto la sesión cambió (409).
                const enc = await cifrarFragmento(share, sesion.bp_public_key);
                await recuperacionService.depositarFragmento(boveda.pid, {
                    x_fragmento: share.id,
                    epk_hex: enc.epkHex,
                    iv_hex: enc.ivHex,
                    ciphertext_hex: enc.ciphertextHex,
                    nombre_declarado: nombreDeclarado,
                    vinculo_declarado: vinculoDeclarado,
                    bp_public_key: sesion.bp_public_key,
                });
                wipe(share.y);
                recordarNombre(boveda.pid, nombreDeclarado);
                navigate(`/recuperacion/${boveda.pid}/custodio`);
            } else {
                if (!passphrase) return;
                const salt = randomSaltHex(16);
                const env = bpKdfEnvelope(salt);
                const { privateKey, publicKeyHex } = await deriveBpKeypair(passphrase, env);
                const enc = await cifrarFragmento(share, publicKeyHex);
                const creada = await recuperacionService.crearSesion(boveda.pid, {
                    x_fragmento: share.id,
                    epk_hex: enc.epkHex,
                    iv_hex: enc.ivHex,
                    ciphertext_hex: enc.ciphertextHex,
                    nombre_declarado: nombreDeclarado,
                    vinculo_declarado: 'Beneficiario Principal',
                    bp_public_key: publicKeyHex,
                    bp_kdf_salt: salt,
                    bp_kdf_params: env.params,
                });
                // Obligatoria: el servidor solo guarda la llave pública, así
                // que sin esta pass-phrase el BP no puede volver a la sesión.
                downloadEmergencySheet({
                    tipo: 'sesion',
                    nombreBoveda: boveda.nombre,
                    pid: boveda.pid,
                    passphrase,
                    xFragmento: share.id,
                    expiraEn: creada.expira_en,
                });
                wipe(share.y);
                recordarNombre(boveda.pid, nombreDeclarado);
                setBp({ pid: boveda.pid, privateKey, dek: null, nombreDeclarado });
                navigate(`/recuperacion/${boveda.pid}/bp`);
            }
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo continuar.', "Couldn't continue.")));
            const status = (e as { response?: { status?: number } })?.response?.status;
            // La sesión cambió, expiró o ya tenía este fragmento: se muestra
            // su estado actual para que el custodio vuelva a decidir.
            if (sesion.existe && (status === 404 || status === 409)) await refrescarSesion();
        } finally {
            setEnviando(false);
        }
    };

    // Solo aplica al fundar (unirse como custodio no necesita pass-phrase):
    // mismo piso de entropía que al crear una bóveda, para que la sesión
    // efímera no dependa de un secreto fácil de adivinar.
    const nuevaPassBits = passphraseBits(passphrase);
    const nuevaPassMeter = passphraseMeter(nuevaPassBits);
    const nuevaPassOk =
        passphrase.length >= 12 && (nuevaPassBits >= MIN_PASSPHRASE_BITS || passphrase.length >= 30);
    const puedeConfirmarNuevo =
        !!nombreDeclarado.trim() && (sesion?.existe ? !sesionExpirada : nuevaPassOk) && !enviando;

    return (
        <div className="recuperacion-page">
            <div className="auth-theme-toggle">
                <LanguageToggle />
                <button
                    type="button"
                    className="theme-toggle"
                    onClick={() => setTheme(toggleTheme())}
                    title={theme === 'dark' ? t('Modo claro', 'Light mode') : t('Modo oscuro', 'Dark mode')}
                    aria-label={t('Cambiar tema', 'Toggle theme')}
                >
                    <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
                </button>
            </div>

            <div className="card card-recuperacion animate__animated animate__zoomIn">
                <div className="top-gradient"></div>

                <div className="card-body p-4 p-md-5">
                    <div className="auth-logo">
                        <KleimosLogo tamano="md" />
                    </div>
                    <div className="text-center mb-4">
                        <div className="d-inline-block p-3 rounded-circle bg-light shadow-sm">
                            <i
                                className={`fas ${boveda ? 'fa-puzzle-piece' : 'fa-search-location'} fa-3x`}
                                style={{ color: 'var(--escom-blue)' }}
                            ></i>
                        </div>
                        <h3 className="fw-bold mb-1" style={{ color: 'var(--escom-blue)' }}>
                            {boveda ? t('Validación de Identidad', 'Identity Validation') : t('Localizar Patrimonio', 'Locate Estate')}
                        </h3>
                        <p className="text-muted small">
                            {boveda
                                ? t('Sube tu fragmento para continuar el protocolo de recuperación.', 'Upload your share to continue the recovery protocol.')
                                : t('Escribe el código de la bóveda para empezar la recuperación.', 'Enter the vault code to start the recovery.')}
                        </p>
                    </div>

                    {!boveda && (
                        <>
                            <div className="mb-4">
                                <label className="form-label small fw-bold text-muted">
                                    {t('Código de la bóveda', 'Vault code')}
                                </label>
                                <div className="input-group">
                                    <span className="input-group-text">
                                        <i className="fas fa-hashtag"></i>
                                    </span>
                                    <input
                                        type="text"
                                        className="form-control shadow-none"
                                        placeholder={t('Ej. V1StGXR8_Z5jdHi6B-myT', 'e.g. V1StGXR8_Z5jdHi6B-myT')}
                                        value={pidInput}
                                        onChange={(e) => setPidInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && buscar(pidInput)}
                                        disabled={buscando}
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <button
                                type="button"
                                className="btn btn-ipn w-100 py-3 shadow-sm"
                                onClick={() => buscar(pidInput)}
                                disabled={buscando || !pidInput.trim()}
                            >
                                {buscando ? (
                                    t('Localizando...', 'Locating...')
                                ) : (
                                    <>
                                        {t('Rastrear Bóveda', 'Find Vault')} <i className="fas fa-search ms-2"></i>
                                    </>
                                )}
                            </button>
                        </>
                    )}

                    {boveda && (
                        <div className="animate__animated animate__fadeIn">
                            <div className="mb-4 text-center">
                                <p className="m-0 fw-bold fs-5">{boveda.nombre}</p>
                                <p className="m-0 text-muted small">{boveda.categoria ? categoriaLabel(boveda.categoria) : t('Sin categoría', 'No category')}</p>
                                <p className="m-0 text-muted small">
                                    {t('Umbral', 'Threshold')}: {boveda.umbral_k ?? '—'} {t('de', 'of')} {boveda.total_fragmentos_n ?? '—'} {t('fragmentos', 'shares')}
                                </p>
                            </div>

                            {aviso && <div className="alert alert-info py-2 small">{aviso}</div>}

                            {!share && (
                                <>
                                    <label className="recuperacion-label d-block mb-1">{t('Tu fragmento (.sss)', 'Your share (.sss)')}</label>
                                    <label
                                        className={`recuperacion-dropzone d-block mb-3 ${validando ? 'is-busy' : ''}`}
                                    >
                                        <input
                                            type="file"
                                            accept=".sss,text/plain"
                                            hidden
                                            disabled={validando}
                                            onChange={(e) => onFile(e.target.files?.[0])}
                                        />
                                        {validando ? (
                                            <>
                                                <i className="fas fa-sync fa-spin mb-2" />
                                                <p className="m-0 small fw-bold">{t('Validando fragmento…', 'Validating share…')}</p>
                                            </>
                                        ) : (
                                            <>
                                                <i className="fas fa-key mb-2" />
                                                <p className="m-0 small fw-bold">{t('Selecciona tu fragmento', 'Select your share')}</p>
                                                <p className="m-0 small text-muted">
                                                    {t('Se revisa aquí mismo y nunca sale de tu navegador.', 'It is checked right here and never leaves your browser.')}
                                                </p>
                                            </>
                                        )}
                                    </label>
                                </>
                            )}

                            {esFundador && (
                                <div className="animate__animated animate__fadeIn">
                                    <div className="recuperacion-status mb-3">
                                        <small className="fw-bold text-success">
                                            <i className="fas fa-crown me-1" />{' '}
                                            {t(
                                                'Fragmento reconocido — eres el Beneficiario Principal de esta sesión.',
                                                'Share recognized — you are the Primary Beneficiary of this session.',
                                            )}
                                        </small>
                                    </div>
                                    <label className="recuperacion-label d-block mb-1">{t('Clave de la sesión', 'Session key')}</label>
                                    <input
                                        type="password"
                                        className="form-control shadow-none mb-3"
                                        placeholder="••••••••••••"
                                        value={passphrase}
                                        onChange={(e) => setPassphrase(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && entrarComoBP()}
                                        autoFocus
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-ipn w-100 py-3 shadow-sm"
                                        onClick={entrarComoBP}
                                        disabled={enviando || !passphrase}
                                    >
                                        {enviando ? t('Entrando…', 'Entering…') : t('Entrar como Beneficiario Principal', 'Enter as Primary Beneficiary')}
                                    </button>
                                </div>
                            )}

                            {yaDepositado && (
                                <div className="animate__animated animate__fadeIn">
                                    <div className="recuperacion-status mb-3">
                                        <small className="fw-bold text-success">
                                            <i className="fas fa-check-circle me-1" />{' '}
                                            {t('Ya depositaste este fragmento anteriormente.', 'You already deposited this share earlier.')}
                                        </small>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-ipn w-100 py-3 shadow-sm"
                                        onClick={entrarComoCustodio}
                                    >
                                        {t('Entrar a la sesión', 'Enter the session')} <i className="fas fa-arrow-right ms-2" />
                                    </button>
                                </div>
                            )}

                            {esNuevo && (
                                <div className="animate__animated animate__fadeIn">
                                    <div className="recuperacion-status mb-3">
                                        <small className="fw-bold text-success">
                                            <i className="fas fa-check-circle me-1" /> {t('Fragmento válido', 'Valid share')}
                                        </small>
                                    </div>

                                    {sesion?.existe && (
                                        <>
                                            <p className="small text-muted text-start mb-2">
                                                {t('Ya hay una sesión de recuperación para esta bóveda. Revísala antes de unirte: tu fragmento se cifrará para su Beneficiario Principal y solo él podrá usarlo. Si no te unes, tu fragmento no sale de tu navegador.', "There's already a recovery session for this vault. Review it before joining: your share will be encrypted for its Primary Beneficiary and only they can use it. If you don't join, your share never leaves your browser.")}
                                            </p>
                                            <VistaPreviaSesion sesion={sesion} restanteMs={restanteMs} />
                                        </>
                                    )}

                                    <div className="row g-3 mb-3">
                                        <div className={sesion?.existe ? 'col-md-6' : 'col-12'}>
                                            <label className="recuperacion-label d-block mb-1">
                                                {t('Nombre o alias público', 'Public name or alias')}
                                            </label>
                                            <input
                                                type="text"
                                                className="form-control shadow-none"
                                                placeholder={t('Ej. Lucía Pérez', 'e.g. Lucy Smith')}
                                                value={nombreDeclarado}
                                                onChange={(e) => setNombreDeclarado(e.target.value)}
                                                autoFocus={!sesion?.existe}
                                            />
                                        </div>
                                        {sesion?.existe && (
                                            <div className="col-md-6">
                                                <label className="recuperacion-label d-block mb-1">
                                                    {t('Vínculo declarado', 'Declared relationship')}
                                                </label>
                                                <select
                                                    className="form-select shadow-none"
                                                    value={vinculoDeclarado}
                                                    onChange={(e) => setVinculoDeclarado(e.target.value)}
                                                >
                                                    {PARENTESCO_OPCIONES.map((v) => (
                                                        <option key={v} value={v}>
                                                            {parentescoLabel(v)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    {!sesion?.existe && (
                                        <>
                                            <div className="bg-light p-3 rounded-3 mb-3 text-start small">
                                                {getLang() === 'es' ? (
                                                    <p className="m-0">
                                                        No hay ninguna sesión de recuperación activa para esta bóveda.
                                                        Al continuar te vuelves el <strong>Beneficiario Principal</strong>{' '}
                                                        — crea una clave de la sesión para poder volver a entrar después
                                                        (no es la llave maestra de la bóveda; esta clave es solo tuya y solo
                                                        para esta recuperación).
                                                    </p>
                                                ) : (
                                                    <p className="m-0">
                                                        There's no active recovery session for this vault. If you continue
                                                        you become the <strong>Primary Beneficiary</strong>{' '}
                                                        — create a session key so you can get back in later (it isn't the
                                                        vault's master key; this key is yours alone and only for this
                                                        recovery).
                                                    </p>
                                                )}
                                            </div>
                                            <div className="d-flex justify-content-between align-items-center mb-1">
                                                <label className="recuperacion-label m-0">
                                                    {t('Nueva clave de la sesión', 'New session key')}
                                                </label>
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-light"
                                                    onClick={() => {
                                                        setPassphrase(suggestPassphrase());
                                                        setShowNuevaPass(true);
                                                    }}
                                                >
                                                    <i className="fas fa-dice me-1" /> {t('Sugerir', 'Suggest')}
                                                </button>
                                            </div>
                                            <div className="input-group">
                                                <input
                                                    type={showNuevaPass ? 'text' : 'password'}
                                                    className="form-control shadow-none"
                                                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                                                    placeholder={t('ocho-palabras-al-azar-separadas-por-guion', 'eight-random-words-separated-by-hyphens')}
                                                    value={passphrase}
                                                    onChange={(e) => setPassphrase(e.target.value)}
                                                />
                                                <button
                                                    className="btn btn-outline-secondary"
                                                    type="button"
                                                    onClick={() => setShowNuevaPass((s) => !s)}
                                                >
                                                    {showNuevaPass ? t('Ocultar', 'Hide') : t('Mostrar', 'Show')}
                                                </button>
                                            </div>
                                            <div className="recuperacion-strength-meter">
                                                <div
                                                    className="recuperacion-strength-fill"
                                                    style={{ width: `${nuevaPassMeter.pct}%`, background: nuevaPassMeter.color }}
                                                />
                                            </div>
                                            {passphrase && (
                                                <div className="d-flex justify-content-between small">
                                                    <span style={{ color: nuevaPassMeter.color, fontWeight: 700 }}>
                                                        {nuevaPassMeter.label}
                                                    </span>
                                                    {nuevaPassMeter.debil && (
                                                        <span className="text-muted">{t('usa «Sugerir» para una frase segura', 'use “Suggest” for a secure phrase')}</span>
                                                    )}
                                                </div>
                                            )}
                                            <p className="m-0 mb-3 mt-2 text-muted small">
                                                <i className="fas fa-file-arrow-down me-1" />{' '}
                                                {getLang() === 'es' ? (
                                                    <>
                                                        Al fundar la sesión se descargará una <strong>hoja de emergencia</strong>{' '}
                                                        con esta clave: la necesitarás, junto con tu fragmento, para volver a esta
                                                        sesión desde cualquier dispositivo. Guárdala en físico.
                                                    </>
                                                ) : (
                                                    <>
                                                        When you start the session an <strong>emergency sheet</strong> with this
                                                        key will download: you'll need it, along with your share, to return to this
                                                        session from any device. Keep it on paper.
                                                    </>
                                                )}
                                            </p>
                                        </>
                                    )}

                                    {sesionExpirada && (
                                        <div className="alert alert-warning py-2 small d-flex justify-content-between align-items-center gap-2">
                                            <span>{t('Esta sesión ya expiró; ya no acepta fragmentos.', 'This session has expired; it no longer accepts shares.')}</span>
                                            <button type="button" className="btn btn-sm btn-light" onClick={refrescarSesion}>
                                                {t('Volver a revisar', 'Check again')}
                                            </button>
                                        </div>
                                    )}

                                    {sesion?.existe ? (
                                        <div className="d-flex gap-2">
                                            <button
                                                type="button"
                                                className="btn btn-light w-100 rounded-pill"
                                                onClick={noUnirme}
                                                disabled={enviando}
                                            >
                                                {t('No unirme', "Don't join")}
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-ipn w-100 py-3 shadow-sm"
                                                onClick={confirmarNuevo}
                                                disabled={!puedeConfirmarNuevo}
                                            >
                                                {enviando ? t('Enviando…', 'Sending…') : t('Unirme y aportar mi fragmento', 'Join and contribute my share')}
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            className="btn btn-ipn w-100 py-3 shadow-sm"
                                            onClick={confirmarNuevo}
                                            disabled={!puedeConfirmarNuevo}
                                        >
                                            {enviando ? t('Enviando…', 'Sending…') : t('Fundar sesión y descargar hoja', 'Start session and download sheet')}
                                        </button>
                                    )}
                                </div>
                            )}

                            <button
                                type="button"
                                className="btn btn-light w-100 rounded-pill mt-3"
                                onClick={buscarOtra}
                            >
                                {t('Buscar otra bóveda', 'Look up another vault')}
                            </button>
                        </div>
                    )}
                </div>

                <div className="bg-light p-3 text-center border-top">
                    <Link to="/" className="text-decoration-none small fw-bold" style={{ color: 'var(--ipn-maroon)' }}>
                        <i className="fas fa-arrow-left me-1"></i> {t('Regresar', 'Back')}
                    </Link>
                </div>
            </div>

            {notFound && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.6)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg text-center" style={{ borderRadius: 20, overflow: 'hidden' }}>
                            <div style={{ height: 6, background: 'linear-gradient(90deg,#621132,#003366)' }} />
                            <div className="modal-body p-5">
                                <div className="mb-4 text-danger animate__animated animate__shakeX">
                                    <i className="fas fa-search-minus fa-4x" />
                                </div>
                                <h4 className="fw-bold">{t('Sin resultados', 'No results')}</h4>
                                <p className="text-muted small">
                                    {t('Ese identificador no corresponde a ninguna bóveda en recuperación.', "That identifier doesn't match any vault in recovery.")}
                                </p>
                                <button className="btn btn-secondary rounded-pill px-4 mt-3" onClick={reintentar}>
                                    {t('Entendido', 'Got it')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
