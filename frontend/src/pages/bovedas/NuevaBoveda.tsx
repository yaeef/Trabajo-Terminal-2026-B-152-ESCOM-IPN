import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { bovedasService } from '../../services/bovedas.service';
import { CATEGORIAS_BOVEDA, categoriaLabel, type CustodioResponse } from '../../types/bovedas.types';
import { custodioNotificable } from '../../types/custodios.types';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import { subscriptionService } from '../../services/subscription.service';
import {
    deriveDEK,
    computeVerifier,
    kdfEnvelope,
    randomSaltHex,
    suggestPassphrase,
    passphraseBits,
    passphraseMeter as meter,
    MIN_PASSPHRASE_BITS as MIN_BITS,
    deriveFromEnvelope,
} from '../../crypto/vaultCrypto';
import { wipe } from '../../crypto/sensitiveMemory';
import { downloadEmergencySheet } from '../../crypto/emergencySheet';
import {
    splitKey,
    encodeShareFile,
    downloadText,
    slugNombreArchivo,
    type SplitResult,
} from '../../crypto/sss';
import './bovedas.css';
import PrimerPasoCustodios from '../../components/PrimerPasoCustodios';
import ProtocoloPrimerPaso from '../../components/ProtocoloPrimerPaso';
import { getLang, t } from '../../i18n';

const MIN_N = 3; // RN-006: con mayoría simple, n=2 no admite ningún k válido
const MAX_N = 10; // tope absoluto del reparto (el plan puede permitir menos)
/** RN-006: k debe representar mayoría simple de los n custodios (floor(n/2)+1 <= k < n). */
const minK = (n: number) => Math.floor(n / 2) + 1;
const rango = (a: number, b: number) => Array.from({ length: Math.max(b - a + 1, 0) }, (_, i) => a + i);

const steps = () => [t('Configuración', 'Setup'), t('Fragmentación', 'Splitting'), t('Vinculación', 'Linking'), t('Subir Activos', 'Upload Assets')];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Stepper({ step }: { step: number }) {
    return (
        <div className="stepper">
            {steps().map((label, i) => {
                const n = i + 1;
                const cls = n < step ? 'done' : n === step ? 'active' : '';
                return (
                    <div className={`step ${cls}`} key={n}>
                        <div className="step-circle">{n < step ? <i className="fas fa-check" /> : n}</div>
                        <div className="step-label">{label}</div>
                    </div>
                );
            })}
        </div>
    );
}

/** Cascarón de modal estilo Kleimos (backdrop + tira de gradiente). */
function WizardModal({ children, danger }: { children: ReactNode; danger?: boolean }) {
    return (
        <div className="modal fade show d-block wizard-modal" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content shadow-lg">
                    <div className="modal-header-gradient" style={danger ? { background: 'var(--danger-red)' } : undefined} />
                    <div className="modal-body p-5 text-center">{children}</div>
                </div>
            </div>
        </div>
    );
}

type ModalName = null | 'passWarn' | 'hoja' | 'dist' | 'confirm' | 'limit' | 'success';

export default function NuevaBoveda() {
    const navigate = useNavigate();
    const [sp] = useSearchParams();
    const resumeId = sp.get('resume') ? Number(sp.get('resume')) : null;

    const [step, setStep] = useState(1);
    const [busy, setBusy] = useState(false);
    const { notifyError } = useNotice();

    // secreto en memoria — nunca se persiste ni se envía
    const [dek, setDek] = useState<Uint8Array | null>(null);
    const [verifier, setVerifier] = useState('');
    const [bovedaId, setBovedaId] = useState<number | null>(null);

    // paso 1
    const [nombre, setNombre] = useState('');
    const [categoria, setCategoria] = useState('Finanzas / Crypto');
    const [mensaje, setMensaje] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [showPass, setShowPass] = useState(false);
    // datos de la bóveda creada (para la hoja de emergencia)
    const [bovedaPid, setBovedaPid] = useState('');

    // paso 2: primero el total (n) y después cuántos abren (k)
    const [n, setN] = useState<number | null>(null);
    const [k, setK] = useState<number | null>(null);
    const [maxCustodiosPlan, setMaxCustodiosPlan] = useState<number>(MAX_N);
    const [hojaConfirmada, setHojaConfirmada] = useState(false);
    const [split, setSplit] = useState<SplitResult | null>(null);
    const [xCoords, setXCoords] = useState<number[]>([]);

    // Referencias al material sensible vivo, para borrarlo al desmontar
    // (si el usuario abandona el wizard sin llegar a subir el VSS).
    const dekRef = useRef<Uint8Array | null>(null);
    const sharesRef = useRef<SplitResult | null>(null);
    useEffect(() => { dekRef.current = dek; }, [dek]);
    useEffect(() => { sharesRef.current = split; }, [split]);
    useEffect(
        () => () => {
            wipe(dekRef.current);
            sharesRef.current?.shares.forEach((s) => wipe(s.y));
        },
        [],
    );

    // paso 3
    const [directorio, setDirectorio] = useState<CustodioResponse[]>([]);
    const [loadingDirectorio, setLoadingDirectorio] = useState(true);
    const [selected, setSelected] = useState<number[]>([]);

    // modales + animación de progreso
    const [modal, setModal] = useState<ModalName>(null);
    const [distPhase, setDistPhase] = useState<'warn' | 'downloading' | 'verify'>('warn');
    const [prog, setProg] = useState({ pct: 0, text: '' });
    const limitTimer = useRef<number | null>(null);

    // --- resume ---
    const [resumeReady, setResumeReady] = useState(!resumeId);
    useEffect(() => {
        if (!resumeId) return;
        bovedasService
            .get(resumeId)
            .then((b) => {
                setBovedaId(b.id);
                setNombre(b.nombre);
                setCategoria(b.categoria ?? '');
                setMensaje(b.mensaje_custodios ?? '');
                setBovedaPid(b.pid); // permite volver a descargar la hoja al reanudar
                if (b.umbral_k) setK(b.umbral_k);
                if (b.total_fragmentos_n) setN(b.total_fragmentos_n);
            })
            .catch((e) => notifyError(getApiErrorMessage(e, t('No se pudo cargar la bóveda.', "Couldn't load the vault."))));
    }, [resumeId]);

    const handleResumeUnlock = async () => {
        if (!bovedaId) return;
        setBusy(true);
        try {
            const b = await bovedasService.get(bovedaId);
            const { dek: d, verifier: v } = await deriveFromEnvelope(passphrase, b.kdf);
            await bovedasService.verifyPassphrase(bovedaId, v);
            setVerifier(v);
            if (b.estado === 'borrador') {
                setDek(d); // se necesita para re-fragmentar en el paso 2
                setStep(2);
            } else {
                wipe(d); // bóveda ya activa: no hace falta la DEK
                const vss = await bovedasService.getVss(bovedaId);
                setXCoords(vss.x_coords);
                setStep(3);
            }
            setResumeReady(true);
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('Llave maestra incorrecta.', 'Incorrect master key.')));
        } finally {
            setBusy(false);
        }
    };

    // --- paso 1 -> crear bóveda ---
    const submitStep1 = async () => {
        setBusy(true);
        try {
            const salt = randomSaltHex(16);
            const d = await deriveDEK(passphrase, salt);
            const v = await computeVerifier(d);
            const b = await bovedasService.create({
                nombre,
                categoria: categoria || null,
                mensaje_custodios: mensaje || null,
                kdf: kdfEnvelope(salt),
                passphrase_verifier: v,
            });
            setDek(d);
            setVerifier(v);
            setBovedaId(b.id);
            setBovedaPid(b.pid);
            // Obligatoria: sin la llave maestra (ni recuperación por custodios)
            // los activos son irrecuperables. Necesita el PID, así que va
            // justo después de crear la bóveda. El navegador puede bloquear la
            // descarga: la ventana 'hoja' deja volver a bajarla y pide
            // confirmar que se tiene antes de seguir.
            downloadEmergencySheet({ tipo: 'boveda', nombreBoveda: nombre, pid: b.pid, passphrase });
            setHojaConfirmada(false);
            setModal('hoja');
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo crear la bóveda.', "Couldn't create the vault.")));
        } finally {
            setBusy(false);
        }
    };

    const descargarHoja = () => {
        if (!bovedaPid) return;
        downloadEmergencySheet({ tipo: 'boveda', nombreBoveda: nombre, pid: bovedaPid, passphrase });
    };

    // --- paso 2 -> fragmentar (WASM) ---
    const doSplit = async () => {
        if (!dek || !n || !k) return;
        setBusy(true);
        try {
            split?.shares.forEach((s) => wipe(s.y)); // descarta un reparto previo
            const r = await splitKey(dek, n, k);
            setSplit(r);
            setXCoords(r.xCoords);
        } catch (e) {
            notifyError((e as Error).message || t('Falló la fragmentación.', 'Splitting failed.'));
        } finally {
            setBusy(false);
        }
    };

    const submitStep2 = async () => {
        if (!bovedaId || !split || !n || !k) return;
        setBusy(true);
        try {
            await bovedasService.uploadVss(bovedaId, {
                passphrase_verifier: verifier,
                n,
                k,
                commitments_hex: split.commitmentsHex,
                x_coords: split.xCoords,
            });
            // No se borran la DEK ni los fragmentos aquí: el Paso 3 todavía
            // necesita el valor y de cada fragmento para generar los .sss con
            // el nombre del custodio asignado. Se borran al final de submitStep3.
            setStep(3);
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudieron guardar los fragmentos. Inténtalo de nuevo.', "Couldn't save the shares. Please try again.")));
        } finally {
            setBusy(false);
        }
    };

    // --- protocolo de vida: antes de la PRIMERA bóveda se revisa y confirma.
    // Sin columna nueva en la BD: "primera" = el propietario no tiene bóvedas.
    const [tieneBovedas, setTieneBovedas] = useState<boolean | null>(resumeId ? true : null);
    const [protocoloConfirmado, setProtocoloConfirmado] = useState(false);
    useEffect(() => {
        if (resumeId) return;
        bovedasService
            .list()
            .then((l) => setTieneBovedas(l.length > 0))
            .catch(() => setTieneBovedas(true)); // si falla, no bloquea; el protocolo sigue en Configuración
    }, [resumeId]);

    // --- directorio de custodios: se necesita desde el Paso 2 (validar que haya
    // suficientes verificados antes de fragmentar), no solo en el Paso 3 ---
    useEffect(() => {
        bovedasService
            .listDirectorio()
            .then(setDirectorio)
            .catch((e) => notifyError(getApiErrorMessage(e, t('No se pudo cargar el directorio de custodios.', "Couldn't load the custodian directory."))))
            .finally(() => setLoadingDirectorio(false));
        // Tope de fragmentos del plan (= custodios que permite). Si falla, se
        // usa el tope general y el backend sigue validando.
        subscriptionService
            .getActual()
            .then((a) => setMaxCustodiosPlan(Math.min(a.plan.max_custodios, MAX_N)))
            .catch(() => undefined);
    }, []);

    const toggleCustodio = (id: number) => {
        const c = directorio.find((d) => d.id === id);
        if (c && !custodioNotificable(c)) return; // sin canal verificado
        setSelected((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id);
            if (n && prev.length >= n) {
                setModal('limit');
                if (limitTimer.current) window.clearTimeout(limitTimer.current);
                limitTimer.current = window.setTimeout(() => setModal((m) => (m === 'limit' ? null : m)), 3000);
                return prev;
            }
            return [...prev, id];
        });
    };

    const asignaciones = useMemo(
        () => selected.map((id_custodio, i) => ({ id_custodio, x_fragmento: xCoords[i] })),
        [selected, xCoords],
    );

    const submitStep3 = async () => {
        if (!bovedaId) return;
        setBusy(true);
        try {
            await bovedasService.setCustodios(bovedaId, { passphrase_verifier: verifier, asignaciones });
            // Ya se guardó la vinculación (y, si aplicaba, ya se distribuyeron
            // los .sss con el nombre de cada custodio): ahora sí se borran.
            wipe(dek);
            split?.shares.forEach((s) => wipe(s.y));
            setDek(null);
            setSplit(null);
            setStep(4);
        } catch (e) {
            notifyError(getApiErrorMessage(e, t('No se pudo confirmar la vinculación.', "Couldn't confirm the linking.")));
        } finally {
            setBusy(false);
        }
    };

    // --- paso 4: modal de éxito con auto-redirección ---
    useEffect(() => {
        if (step !== 4) return;
        setModal('success');
        setProg({ pct: 0, text: '' });
        const t1 = setTimeout(() => setProg({ pct: 100, text: '' }), 100);
        const t2 = setTimeout(() => navigate('/bovedas'), 3100);
        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
        };
    }, [step, navigate]);

    const selectedCustodios = selected
        .map((id, i) => ({ c: directorio.find((d) => d.id === id), x: xCoords[i], num: i + 1 }))
        .filter((r): r is { c: CustodioResponse; x: number; num: number } => Boolean(r.c));

    const notificables = directorio.filter(custodioNotificable);

    // Opciones válidas del paso 2: el total va de 3 al menor entre lo que
    // permite el plan y los custodios confirmados; el umbral, de más de la
    // mitad a uno menos que el total.
    const maxN = Math.max(MIN_N, Math.min(maxCustodiosPlan, notificables.length || MIN_N));
    const opcionesN = rango(MIN_N, maxN);
    const opcionesK = n ? rango(minK(n), n - 1) : [];
    const elegirN = (nv: number) => {
        setN(nv);
        const ks = rango(minK(nv), nv - 1);
        setK(ks.length === 1 ? ks[0] : null);
        setSplit(null);
    };
    // Con una sola opción (plan Gratuito: 3 custodios) se elige sola.
    useEffect(() => {
        if (step === 2 && !resumeId && n === null && opcionesN.length === 1) elegirN(opcionesN[0]);
    }, [step, opcionesN.length]);

    // Descarga cada .sss ya nombrado con el custodio que lo recibirá. Los
    // compromisos VSS no se descargan: ya están en el servidor y contra ellos
    // se verifican los fragmentos (recuperación, atestación, reasignación).
    // Solo se puede llamar con `split` vivo (recién fragmentado en esta
    // sesión); si se reanuda una bóveda ya fragmentada/distribuida, este paso
    // se omite por completo (ver botón "Vincular y Continuar").
    const downloadAllParaCustodios = async () => {
        if (!split) return;
        for (const { c, x, num } of selectedCustodios) {
            const s = split.shares.find((sh) => sh.id === x);
            if (!s) continue;
            downloadText(
                `fragmento_${slugNombreArchivo(nombre)}_${slugNombreArchivo(c.nombre)}_${num}.sss`,
                await encodeShareFile(s.id, s.y),
            );
            await sleep(400); // espaciadas: algunos navegadores frenan descargas seguidas
        }
    };

    // -------------------------------------------------------------------
    // Primer paso: sin custodios confirmados no se empieza una bóveda nueva
    // (el backend también lo exige). Reanudar un borrador no pasa por aquí.
    if (!resumeId && step === 1 && !loadingDirectorio && notificables.length < MIN_N) {
        return (
            <DashboardLayout activeItem="bovedas" topBarLabel={t('Configurar Bóveda', 'Set Up Vault')} backTo="/bovedas">
                <PrimerPasoCustodios custodios={directorio} variante="pagina" />
            </DashboardLayout>
        );
    }

    // Segundo paso: con los custodios listos, la primera bóveda pide confirmar
    // el protocolo de vida (umbral, espera y canales) antes del paso 1.
    if (!resumeId && step === 1 && !protocoloConfirmado && tieneBovedas !== true) {
        return (
            <DashboardLayout activeItem="bovedas" topBarLabel={t('Configurar Bóveda', 'Set Up Vault')} backTo="/bovedas">
                {tieneBovedas === null || loadingDirectorio ? (
                    <div className="text-center text-muted py-5">{t('Cargando…', 'Loading…')}</div>
                ) : (
                    <ProtocoloPrimerPaso
                        custodiosListos={notificables.map((c) => c.nombre)}
                        onListo={() => setProtocoloConfirmado(true)}
                        onVolver={() => navigate('/bovedas')}
                    />
                )}
            </DashboardLayout>
        );
    }

    if (!resumeReady) {
        return (
            <DashboardLayout activeItem="bovedas" topBarLabel={t('Configurar Bóveda', 'Set Up Vault')} backTo="/bovedas">
                <div className="config-card" style={{ maxWidth: 560 }}>
                    <h3 className="fw-bold mb-1">{t('Reanudar configuración', 'Resume setup')}</h3>
                    {getLang() === 'es' ? (
                        <p className="text-muted">
                            Escribe la llave maestra de <strong>{nombre || 'la bóveda'}</strong> para continuar.
                            Kleimos no la guarda en ningún lado.
                        </p>
                    ) : (
                        <p className="text-muted">
                            Enter the master key of <strong>{nombre || 'the vault'}</strong> to continue. Kleimos
                            doesn't store it anywhere.
                        </p>
                    )}
                    <input
                        type="password"
                        className="form-control shadow-none mb-3"
                        placeholder={t('Llave maestra de la bóveda', 'Vault master key')}
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                    />
                    <button className="btn btn-ipn" onClick={handleResumeUnlock} disabled={busy || !passphrase}>
                        {busy ? t('Verificando…', 'Verifying…') : t('Desbloquear', 'Unlock')}
                    </button>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout activeItem="bovedas" topBarLabel={t('Configurar Nueva Bóveda', 'Set Up New Vault')} backTo="/bovedas">
            <Stepper step={step} />

            {/* ---------- PASO 1 ---------- */}
            {step === 1 && (
                <div className="config-card">
                    <h3 className="fw-bold mb-1">{t('Paso 1: Configuración', 'Step 1: Setup')}</h3>
                    <p className="text-muted mb-4">{t('Ponle nombre a la bóveda y elige su llave maestra: con ella se protegen tus archivos.', 'Name the vault and choose its master key: it protects your files.')}</p>

                    <div className="row g-3 mb-3">
                        <div className="col-md-8">
                            <label className="form-label-b d-block">{t('Nombre de la bóveda', 'Vault name')}</label>
                            <input className="form-control shadow-none" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={t('Ej: Carteras Frías 2026', 'e.g. Cold Wallets 2026')} />
                        </div>
                        <div className="col-md-4">
                            <label className="form-label-b d-block">{t('Categoría', 'Category')}</label>
                            <select className="form-select shadow-none" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                                {CATEGORIAS_BOVEDA.map((c) => (
                                    <option key={c} value={c}>
                                        {categoriaLabel(c)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="mb-3">
                        <label className="form-label-b d-block">{t('Mensaje para custodios (opcional)', 'Message for custodians (optional)')}</label>
                        <textarea className="form-control shadow-none" rows={2} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder={t('Lo verán tus custodios cuando abran la bóveda…', 'Your custodians will see it when they open the vault…')} />
                    </div>

                    {(() => {
                        const bits = passphraseBits(passphrase);
                        const m = meter(bits);
                        const okToContinue = passphrase.length >= 12 && (bits >= MIN_BITS || passphrase.length >= 30);
                        return (
                            <>
                                <div className="passphrase-box mb-3">
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <label className="form-label-b m-0">{t('Llave maestra', 'Master key')}</label>
                                        <button
                                            type="button"
                                            className="btn btn-sm btn-light"
                                            onClick={() => { setPassphrase(suggestPassphrase()); setShowPass(true); }}
                                        >
                                            <i className="fas fa-dice me-1" /> {t('Sugerir', 'Suggest')}
                                        </button>
                                    </div>
                                    <div className="input-group">
                                        <input
                                            type={showPass ? 'text' : 'password'}
                                            className="form-control shadow-none"
                                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                                            value={passphrase}
                                            onChange={(e) => setPassphrase(e.target.value)}
                                            placeholder={t('Escríbela o pulsa «Sugerir»', 'Type it or press “Suggest”')}
                                        />
                                        <button className="btn btn-outline-secondary" type="button" onClick={() => setShowPass((s) => !s)}>
                                            {showPass ? t('Ocultar', 'Hide') : t('Mostrar', 'Show')}
                                        </button>
                                    </div>
                                    <div className="strength-meter">
                                        <div className="strength-fill" style={{ width: `${m.pct}%`, background: m.color }} />
                                    </div>
                                    {passphrase && (
                                        <div className="d-flex justify-content-between small">
                                            <span style={{ color: m.color, fontWeight: 700 }}>{m.label}</span>
                                            {m.debil && (
                                                <span className="text-muted">{t('usa «Sugerir» para una llave segura', 'use “Suggest” for a secure key')}</span>
                                            )}
                                        </div>
                                    )}
                                    <p className="m-0 mt-2 text-muted small">
                                        <i className="fas fa-info-circle me-1" /> {t('Puede ser una frase de varias palabras o una combinación de caracteres al azar: mientras más larga y menos predecible, mejor. Kleimos nunca la guarda.', 'It can be a multi-word phrase or a random combination of characters: the longer and less predictable, the better. Kleimos never stores it.')}
                                    </p>

                                    <div className="passphrase-warning mt-3">
                                        <i className="fas fa-triangle-exclamation me-2" />
                                        {getLang() === 'es' ? (
                                            <span>
                                                <strong>Guardar y recordar tu llave maestra es tu responsabilidad.</strong>{' '}
                                                Si la pierdes, los archivos de la bóveda <strong>no se pueden abrir</strong>{' '}
                                                hasta que se active la recuperación con tus custodios.
                                            </span>
                                        ) : (
                                            <span>
                                                <strong>Keeping and remembering your master key is your responsibility.</strong>{' '}
                                                If you lose it, the vault's files <strong>can't be opened</strong>{' '}
                                                until recovery with your custodians is triggered.
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <p className="small mb-4">
                                    <i className="fas fa-file-arrow-down me-1" />{' '}
                                    {getLang() === 'es' ? (
                                        <>
                                            Al continuar se descargará la <strong>hoja de emergencia</strong> con tu llave
                                            maestra. Imprímela y guárdala en físico; no la subas a la nube ni la compartas.
                                        </>
                                    ) : (
                                        <>
                                            When you continue, the <strong>emergency sheet</strong> with your master key will
                                            download. Print it and keep it on paper; don't upload it to the cloud or share it.
                                        </>
                                    )}
                                </p>

                                <div className="d-flex justify-content-between pt-3 border-top">
                                    <button className="btn btn-light rounded-pill px-4" onClick={() => navigate('/bovedas')}>{t('Cancelar', 'Cancel')}</button>
                                    <button
                                        className="btn btn-ipn"
                                        onClick={() => setModal('passWarn')}
                                        disabled={busy || !nombre || !okToContinue}
                                    >
                                        {busy ? t('Creando bóveda…', 'Creating vault…') : t('Continuar a Fragmentación', 'Continue to Splitting')} <i className="fas fa-arrow-right ms-2" />
                                    </button>
                                </div>
                            </>
                        );
                    })()}
                </div>
            )}

            {/* ---------- PASO 2 ---------- */}
            {step === 2 && (
                <div className="config-card">
                    <h3 className="fw-bold mb-1">{t('Paso 2: Fragmentación', 'Step 2: Splitting')}</h3>
                    <p className="text-muted mb-4">{t('Divide la llave de la bóveda en partes: una por custodio. Elige cuántas partes se necesitan para abrirla.', 'Split the vault key into parts: one per custodian. Choose how many parts are needed to open it.')}</p>

                    <div className="sss-control-box mb-4">
                        <div className="nk-paso">
                            <span className="nk-num">1</span>
                            <div className="flex-grow-1">
                                <p className="form-label-b mb-1">{t('¿En cuántos fragmentos la divides?', 'How many shares do you split it into?')}</p>
                                <p className="text-muted small mb-2">
                                    {opcionesN.length === 1
                                        ? t(
                                              `Tu plan permite ${maxCustodiosPlan} custodios, así que la llave se divide en ${MIN_N} fragmentos.`,
                                              `Your plan allows ${maxCustodiosPlan} custodians, so the key is split into ${MIN_N} shares.`,
                                          )
                                        : t(
                                              `Uno por custodio. Puedes elegir entre ${MIN_N} y ${maxN}: tienes ${notificables.length} custodios confirmados y tu plan permite hasta ${maxCustodiosPlan}.`,
                                              `One per custodian. You can choose between ${MIN_N} and ${maxN}: you have ${notificables.length} confirmed custodians and your plan allows up to ${maxCustodiosPlan}.`,
                                          )}
                                </p>
                                <div className="nk-opciones" role="group" aria-label={t('Total de fragmentos', 'Total shares')}>
                                    {opcionesN.map((v) => (
                                        <button
                                            key={v}
                                            type="button"
                                            className={`nk-opcion ${n === v ? 'activa' : ''}`}
                                            aria-pressed={n === v}
                                            onClick={() => elegirN(v)}
                                        >
                                            {v}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className={`nk-paso ${n ? '' : 'inactivo'}`}>
                            <span className="nk-num">2</span>
                            <div className="flex-grow-1">
                                <p className="form-label-b mb-1">{t('¿Cuántos se necesitan para abrirla?', 'How many are needed to open it?')}</p>
                                <p className="text-muted small mb-2">
                                    {!n
                                        ? t('Primero elige en cuántos fragmentos la divides.', 'First choose how many shares to split it into.')
                                        : opcionesK.length === 1
                                          ? t(
                                                `Con ${n} fragmentos se necesitan ${opcionesK[0]} para abrirla (más de la mitad).`,
                                                `With ${n} shares, ${opcionesK[0]} are needed to open it (more than half).`,
                                            )
                                          : t(
                                                `Con ${n} fragmentos puedes elegir entre ${opcionesK[0]} y ${opcionesK[opcionesK.length - 1]}: deben ser más de la mitad y menos que el total.`,
                                                `With ${n} shares you can choose between ${opcionesK[0]} and ${opcionesK[opcionesK.length - 1]}: more than half and fewer than the total.`,
                                            )}
                                </p>
                                <div className="nk-opciones" role="group" aria-label={t('Fragmentos necesarios para abrir', 'Shares needed to open')}>
                                    {opcionesK.map((v) => (
                                        <button
                                            key={v}
                                            type="button"
                                            className={`nk-opcion ${k === v ? 'activa' : ''}`}
                                            aria-pressed={k === v}
                                            onClick={() => { setK(v); setSplit(null); }}
                                        >
                                            {v}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {n && k && (
                            <div className="logic-hint">
                                <i className="fas fa-shield-alt me-2" />
                                {getLang() === 'es' ? (
                                    <>
                                        Para abrir la bóveda se necesitarán <strong>{k} de {n}</strong> fragmentos. Si se
                                        pierden hasta {n - k}, todavía se podrá abrir.
                                    </>
                                ) : (
                                    <>
                                        Opening the vault will require <strong>{k} of {n}</strong> shares. If up to {n - k}{' '}
                                        are lost, it can still be opened.
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {!loadingDirectorio && n && notificables.length < n && (
                        <p className="text-muted small text-center mb-3">
                            {t(
                                `Tienes ${notificables.length} custodio${notificables.length === 1 ? '' : 's'} con canal verificado y necesitas ${n}.`,
                                `You have ${notificables.length} custodian${notificables.length === 1 ? '' : 's'} with a verified channel and need ${n}.`,
                            )}{' '}
                            <button className="btn btn-link p-0 align-baseline" onClick={() => navigate('/custodios')}>
                                {t('Ir a Custodios', 'Go to Custodians')}
                            </button>{' '}
                            {t('o elige menos fragmentos.', 'or choose fewer shares.')}
                        </p>
                    )}

                    <div className="text-center mb-4">
                        <button
                            className="btn btn-outline-primary px-5"
                            onClick={doSplit}
                            disabled={busy || loadingDirectorio || !n || !k || notificables.length < (n ?? 0)}
                        >
                            <i className="fas fa-key me-2" /> {busy ? t('Generando…', 'Generating…') : t('Generar fragmentos', 'Generate shares')}
                        </button>
                    </div>

                    {split && (
                        <div className="row g-3 mb-3">
                            {split.shares.map((s, i) => (
                                <div className="col-6 col-md-3" key={s.id}>
                                    <div className="share-card text-center">
                                        <i className="fas fa-key mb-2" style={{ color: 'var(--escom-blue)' }} />
                                        <div className="share-id">{t('Fragmento', 'Share')} {i + 1}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {bovedaPid && (
                        <button className="btn btn-sm btn-outline-secondary rounded-pill mb-3" onClick={descargarHoja}>
                            <i className="fas fa-file-arrow-down me-1" /> {t('Descargar hoja de emergencia', 'Download emergency sheet')}
                        </button>
                    )}

                    <div className="d-flex justify-content-between pt-3 border-top">
                        <button className="btn btn-light rounded-pill px-4" onClick={() => setStep(1)} disabled={!!resumeId}>{t('Anterior', 'Previous')}</button>
                        <button
                            className="btn btn-ipn"
                            onClick={submitStep2}
                            disabled={busy || !split}
                        >
                            {busy ? t('Guardando…', 'Saving…') : t('Continuar a Vinculación', 'Continue to Linking')} <i className="fas fa-arrow-right ms-2" />
                        </button>
                    </div>
                </div>
            )}

            {/* ---------- PASO 3 ---------- */}
            {step === 3 && (
                <div className="config-card">
                    <h3 className="fw-bold mb-1">{t('Paso 3: Vinculación de Custodios', 'Step 3: Custodian Linking')}</h3>
                    <p className="text-muted mb-3">
                        {t('Elige a quién le entregas cada fragmento.', 'Choose who receives each share.')}
                    </p>

                    <div className="logic-hint mb-4">
                        <i className="fas fa-users me-2" />
                        {getLang() === 'es' ? (
                            <>
                                Debes vincular <strong>los {n} custodios</strong> (uno por fragmento) ·{' '}
                                <strong>{selected.length}/{n}</strong> seleccionados
                            </>
                        ) : (
                            <>
                                You must link <strong>all {n} custodians</strong> (one per share) ·{' '}
                                <strong>{selected.length}/{n}</strong> selected
                            </>
                        )}
                        <div className="small mt-1" style={{ opacity: 0.85 }}>
                            {t(
                                `Se necesitan ${k} de ${n} para abrir la bóveda: si se pierden hasta ${(n ?? 0) - (k ?? 0)}, todavía se podrá abrir.`,
                                `${k} of ${n} are needed to open the vault: if up to ${(n ?? 0) - (k ?? 0)} are lost, it can still be opened.`,
                            )}
                        </div>
                    </div>

                    {(() => {
                        const notificables = directorio.filter(custodioNotificable);
                        const sinVerificar = directorio.length - notificables.length;
                        return (
                            <>
                                {notificables.length < (n ?? 0) && (
                                    <p className="text-muted small">
                                        {t(
                                            `Tienes ${notificables.length} custodio${notificables.length === 1 ? '' : 's'} con canal verificado y necesitas ${n}.`,
                                            `You have ${notificables.length} custodian${notificables.length === 1 ? '' : 's'} with a verified channel and need ${n}.`,
                                        )}{' '}
                                        <button className="btn btn-link p-0 align-baseline" onClick={() => navigate('/custodios')}>
                                            {t('Ir a Custodios', 'Go to Custodians')}
                                        </button>{' '}
                                        {t('o vuelve al paso anterior y elige menos fragmentos.', 'or go back to the previous step and choose fewer shares.')}
                                    </p>
                                )}
                                {sinVerificar > 0 && (
                                    <p className="small" style={{ color: 'var(--danger-red)' }}>
                                        <i className="fas fa-triangle-exclamation me-1" />
                                        {getLang() === 'es' ? (
                                            <>
                                                {sinVerificar} custodio{sinVerificar === 1 ? '' : 's'} sin canal verificado no
                                                {sinVerificar === 1 ? ' aparece' : ' aparecen'} como seleccionable —
                                                no podría{sinVerificar === 1 ? '' : 'n'} ser notificado
                                                {sinVerificar === 1 ? '' : 's'} en la recuperación.
                                            </>
                                        ) : (
                                            <>
                                                {sinVerificar} custodian{sinVerificar === 1 ? '' : 's'} without a verified channel{' '}
                                                {sinVerificar === 1 ? "isn't" : "aren't"} selectable — they couldn't be notified
                                                during recovery.
                                            </>
                                        )}
                                    </p>
                                )}
                            </>
                        );
                    })()}

                    <div className="row g-3 mb-4">
                        {directorio.map((c) => {
                            const pos = selected.indexOf(c.id);
                            const isSel = pos >= 0;
                            const notificable = custodioNotificable(c);
                            return (
                                <div className="col-md-4" key={c.id}>
                                    <div
                                        className={`custodian-selector-card ${isSel ? 'selected' : ''} ${notificable ? '' : 'is-disabled'}`}
                                        onClick={() => toggleCustodio(c.id)}
                                        title={notificable ? '' : t('Sin canal verificado', 'No verified channel')}
                                    >
                                        {isSel && <span className="frag-chip frag-chip-top">{t('Fragmento', 'Share')} {pos + 1}</span>}
                                        <div className="d-flex align-items-center gap-2">
                                            <div className="custodian-avatar">{c.nombre.slice(0, 2).toUpperCase()}</div>
                                            <div className="flex-grow-1 cust-info">
                                                <p className="m-0 fw-bold small text-truncate">{c.nombre}</p>
                                                <p className="m-0 text-muted text-truncate" style={{ fontSize: '0.65rem' }} title={c.correo}>{c.correo}</p>
                                            </div>
                                            {isSel && <i className="fas fa-check-circle sel-check" aria-hidden="true" />}
                                            {!notificable && <span className="no-verif-chip">{t('sin verificar', 'unverified')}</span>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="d-flex justify-content-between pt-3 border-top">
                        <button className="btn btn-light rounded-pill px-4" onClick={() => setStep(2)} disabled={!!resumeId}>{t('Anterior', 'Previous')}</button>
                        <button
                            className="btn btn-ipn"
                            onClick={() => setModal('confirm')}
                            disabled={busy || selected.length !== n}
                        >
                            {t('Confirmar Vinculación', 'Confirm Linking')} <i className="fas fa-arrow-right ms-2" />
                        </button>
                    </div>
                </div>
            )}

            {/* ---------- PASO 4 (respaldo tras el modal) ---------- */}
            {step === 4 && (
                <div className="config-card text-center">
                    <div className="mb-3" style={{ color: 'var(--escom-blue)' }}><i className="fas fa-check-circle fa-3x" /></div>
                    <h3 className="fw-bold">{t('Bóveda configurada', 'Vault set up')}</h3>
                    <p className="text-muted">{t('Redirigiendo a Mis Bóvedas…', 'Redirecting to My Vaults…')}</p>
                    <button className="btn btn-ipn mt-2" onClick={() => navigate('/bovedas')}>{t('Ir ahora', 'Go now')}</button>
                </div>
            )}

            {/* ═══════════════ MODALES ═══════════════ */}

            {modal === 'passWarn' && (
                <WizardModal>
                    <div className="mb-3 text-warning">
                        <i className="fas fa-shield-virus fa-4x animate__animated animate__pulse animate__infinite" />
                    </div>
                    <h4 className="fw-bold">{t('¡Guarda tu llave maestra!', 'Save your master key!')}</h4>
                    {getLang() === 'es' ? (
                        <p className="text-muted small mb-3">
                            Con esta llave se protegen tus archivos. <strong>Sin ella no podrás abrirlos.</strong> Al
                            continuar se descargará tu hoja de emergencia con ella.
                        </p>
                    ) : (
                        <p className="text-muted small mb-3">
                            This key protects your files. <strong>Without it you won't be able to open them.</strong> When
                            you continue, your emergency sheet with the key will download.
                        </p>
                    )}
                    <div className="bg-light p-3 rounded-3 mb-4 text-start">
                        <p className="small fw-bold mb-1 text-muted text-uppercase">{t('Tu llave maestra:', 'Your master key:')}</p>
                        <code className="fw-bold" style={{ fontSize: '1.05rem', wordBreak: 'break-all' }}>{passphrase}</code>
                    </div>
                    <div className="d-flex gap-3">
                        <button className="btn btn-light w-100 rounded-pill" onClick={() => setModal(null)}>{t('Regresar', 'Back')}</button>
                        <button
                            className="btn btn-ipn w-100"
                            onClick={async () => { setModal(null); await submitStep1(); }}
                        >
                            {t('Continuar y descargar hoja', 'Continue and download sheet')}
                        </button>
                    </div>
                </WizardModal>
            )}

            {modal === 'hoja' && (
                <WizardModal>
                    <div className="mb-3 text-primary"><i className="fas fa-file-arrow-down fa-3x" /></div>
                    <h4 className="fw-bold">{t('Guarda tu llave maestra', 'Keep your master key safe')}</h4>
                    {getLang() === 'es' ? (
                        <p className="text-muted small mb-3">
                            Se descargó tu <strong>hoja de emergencia</strong>. Ábrela, revisa que se vea completa e
                            imprímela o guárdala en un lugar seguro. Si no aparece en tus descargas, tu navegador pudo
                            bloquearla.
                        </p>
                    ) : (
                        <p className="text-muted small mb-3">
                            Your <strong>emergency sheet</strong> was downloaded. Open it, check that it looks complete and
                            print it or keep it somewhere safe. If it's not in your downloads, your browser may have
                            blocked it.
                        </p>
                    )}
                    <button className="btn btn-outline-primary rounded-pill px-4 mb-3" onClick={descargarHoja}>
                        <i className="fas fa-rotate-right me-2" /> {t('Descargar de nuevo', 'Download again')}
                    </button>
                    <label className="d-flex gap-2 text-start small bg-light rounded-3 p-3 mb-4" style={{ cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            className="form-check-input mt-0 flex-shrink-0"
                            checked={hojaConfirmada}
                            onChange={(e) => setHojaConfirmada(e.target.checked)}
                        />
                        <span>{t('Confirmo que tengo mi hoja de emergencia y que puedo leer la llave maestra en ella.', 'I confirm I have my emergency sheet and can read the master key on it.')}</span>
                    </label>
                    <button
                        className="btn btn-ipn w-100"
                        disabled={!hojaConfirmada}
                        onClick={() => {
                            setModal(null);
                            setStep(2);
                        }}
                    >
                        {t('Confirmar y continuar', 'Confirm and continue')}
                    </button>
                </WizardModal>
            )}

            {modal === 'dist' && (
                <WizardModal>
                    {distPhase === 'warn' ? (
                        <>
                            <div className="mb-3 text-warning">
                                <i className="fas fa-paper-plane fa-4x animate__animated animate__tada animate__infinite" />
                            </div>
                            <h4 className="fw-bold">{t('Distribución de Fragmentos', 'Share Distribution')}</h4>
                            {getLang() === 'es' ? (
                                <p className="text-muted small mb-3">
                                    La seguridad depende de que los fragmentos <strong>no se almacenen juntos</strong>. Es tu
                                    responsabilidad entregarlos de forma segura.
                                </p>
                            ) : (
                                <p className="text-muted small mb-3">
                                    Security depends on the shares <strong>not being stored together</strong>. It's your
                                    responsibility to deliver them securely.
                                </p>
                            )}
                            <div className="bg-light p-3 rounded-3 mb-4 text-start small">
                                <ul className="text-muted ps-3 mb-0">
                                    <li>{t('Entrégalos en persona o por un medio seguro.', 'Deliver them in person or through a secure channel.')}</li>
                                    <li>{t('Cada custodio resguarda su fragmento por separado.', 'Each custodian keeps their share separately.')}</li>
                                    <li className="mt-2 text-danger fw-bold">
                                        {t('Al continuar se descargarán todos los fragmentos en este equipo.', 'When you continue, all shares will download to this device.')}
                                    </li>
                                </ul>
                            </div>
                            <div className="d-flex gap-3">
                                <button className="btn btn-light w-100 rounded-pill" onClick={() => setModal(null)}>
                                    {t('Revisar fragmentos', 'Review shares')}
                                </button>
                                <button
                                    className="btn btn-ipn w-100"
                                    onClick={async () => {
                                        setDistPhase('downloading');
                                        await downloadAllParaCustodios();
                                        setDistPhase('verify');
                                    }}
                                >
                                    {t('Aceptar y Descargar', 'Accept and Download')}
                                </button>
                            </div>
                        </>
                    ) : distPhase === 'downloading' ? (
                        <>
                            <div className="mb-3 text-primary">
                                <i className="fas fa-cloud-download-alt fa-4x animate__animated animate__bounce animate__infinite" />
                            </div>
                            <h4 className="fw-bold">{t('Descargando fragmentos…', 'Downloading shares…')}</h4>
                            <p className="text-muted small mb-0">
                                {t('Si tu navegador pregunta si permites varias descargas, elige «Permitir».', 'If your browser asks whether to allow multiple downloads, choose “Allow”.')}
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="mb-3 text-primary"><i className="fas fa-folder-open fa-3x" /></div>
                            <h4 className="fw-bold">{t(`¿Se descargaron los ${selectedCustodios.length} fragmentos?`, `Did all ${selectedCustodios.length} shares download?`)}</h4>
                            <p className="text-muted small mb-3">
                                {t('Revisa tu carpeta de descargas. Si falta alguno, tu navegador pudo bloquear la descarga.', 'Check your downloads folder. If any is missing, your browser may have blocked the download.')}
                            </p>
                            <div className="text-start mb-4">
                                {selectedCustodios.map(({ c, num }) => (
                                    <div className="confirm-list-item" key={c.id}>
                                        <i className="fas fa-file text-muted" />
                                        <span className="small text-break flex-grow-1">
                                            fragmento_{slugNombreArchivo(nombre)}_{slugNombreArchivo(c.nombre)}_{num}.sss
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="d-flex gap-3">
                                <button
                                    className="btn btn-outline-primary w-100 rounded-pill"
                                    disabled={busy}
                                    onClick={async () => {
                                        setDistPhase('downloading');
                                        await downloadAllParaCustodios();
                                        setDistPhase('verify');
                                    }}
                                >
                                    {t('Reintentar descarga', 'Retry download')}
                                </button>
                                <button
                                    className="btn btn-ipn w-100"
                                    disabled={busy}
                                    onClick={async () => {
                                        await submitStep3();
                                    }}
                                >
                                    {busy ? t('Guardando…', 'Saving…') : t('Sí, se descargaron', 'Yes, they downloaded')}
                                </button>
                            </div>
                        </>
                    )}
                </WizardModal>
            )}

            {modal === 'confirm' && (
                <WizardModal>
                    <div className="mb-3 text-primary"><i className="fas fa-clipboard-check fa-3x" /></div>
                    <h4 className="fw-bold">{t('Confirmar Selección', 'Confirm Selection')}</h4>
                    <p className="text-muted small mb-3">
                        {t('Estos custodios recibirán un fragmento y serán los responsables de la recuperación.', 'These custodians will receive a share and will be responsible for recovery.')}
                    </p>
                    <div className="mb-4">
                        {selectedCustodios.map(({ c, num }) => (
                            <div className="confirm-list-item" key={c.id}>
                                <div className="custodian-avatar" style={{ width: 34, height: 34, fontSize: '0.7rem' }}>
                                    {c.nombre.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="text-start flex-grow-1">
                                    <p className="m-0 fw-bold small">{c.nombre}</p>
                                    <p className="m-0 text-muted" style={{ fontSize: '0.6rem' }}>{c.correo}</p>
                                </div>
                                <span className="frag-chip">{t('Fragmento', 'Share')} {num}</span>
                            </div>
                        ))}
                    </div>
                    <div className="d-flex gap-3">
                        <button className="btn btn-light w-100 rounded-pill" onClick={() => setModal(null)}>{t('Modificar', 'Edit')}</button>
                        <button
                            className="btn btn-ipn w-100"
                            onClick={async () => {
                                setModal(null);
                                if (split) {
                                    // Flujo normal: hay que distribuir los .sss
                                    // (ahora con nombre de custodio) antes de guardar.
                                    setDistPhase('warn');
                                    setModal('dist');
                                } else {
                                    // Reanudando una bóveda ya fragmentada/distribuida
                                    // en una sesión anterior: no hay nada nuevo que
                                    // descargar, solo guardar la vinculación.
                                    await submitStep3();
                                }
                            }}
                        >
                            {split ? t('Continuar a la entrega', 'Continue to delivery') : t('Vincular y continuar', 'Link and continue')}
                        </button>
                    </div>
                </WizardModal>
            )}

            {modal === 'limit' && (
                <WizardModal>
                    <div className="mb-3 text-warning">
                        <i className="fas fa-users-slash fa-4x animate__animated animate__shakeX" />
                    </div>
                    <h4 className="fw-bold">{t('Límite Alcanzado', 'Limit Reached')}</h4>
                    <p className="text-muted small mb-0">
                        {t(`Elegiste ${n} fragmentos. No puedes asignar más de ${n} custodios.`, `You chose ${n} shares. You can't assign more than ${n} custodians.`)}
                    </p>
                    <div className="wizard-timebar mt-4">
                        <div className="wizard-timebar-fill" />
                    </div>
                </WizardModal>
            )}

            {modal === 'success' && (
                <WizardModal>
                    <div className="mb-3" style={{ color: 'var(--escom-blue)' }}>
                        <i className="fas fa-check-circle fa-4x animate__animated animate__bounceIn" />
                    </div>
                    <h4 className="fw-bold">{t('¡Bóveda Lista!', 'Vault Ready!')}</h4>
                    <p className="text-muted small mb-0">
                        {t(`${n} custodios vinculados. Te llevamos a Mis bóvedas…`, `${n} custodians linked. Taking you to My Vaults…`)}
                    </p>
                    <div className="wizard-progress mt-4">
                        <div
                            className="wizard-progress-bar"
                            style={{ width: `${prog.pct}%`, transition: 'width 3s linear' }}
                        />
                    </div>
                </WizardModal>
            )}
        </DashboardLayout>
    );
}
