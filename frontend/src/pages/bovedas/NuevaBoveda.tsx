import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { bovedasService } from '../../services/bovedas.service';
import type { CustodioResponse } from '../../types/bovedas.types';
import { custodioNotificable } from '../../types/custodios.types';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
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
    toHex,
} from '../../crypto/vaultCrypto';
import { wipe } from '../../crypto/sensitiveMemory';
import { downloadEmergencySheet } from '../../crypto/emergencySheet';
import {
    splitKey,
    encodeShareFile,
    encodeCommitmentsFile,
    downloadText,
    slugNombreArchivo,
    type SplitResult,
} from '../../crypto/sss';
import './bovedas.css';

const MIN_N = 3; // RN-006: con mayoría simple, n=2 no admite ningún k válido
/** RN-006: k debe representar mayoría simple de los n custodios (floor(n/2)+1 <= k < n). */
const minK = (n: number) => Math.floor(n / 2) + 1;

const STEPS = ['Configuración', 'Fragmentación', 'Vinculación', 'Subir Activos'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Stepper({ step }: { step: number }) {
    return (
        <div className="stepper">
            {STEPS.map((label, i) => {
                const n = i + 1;
                const cls = n < step ? 'done' : n === step ? 'active' : '';
                return (
                    <div className={`step ${cls}`} key={label}>
                        <div className="step-circle">{n < step ? <i className="fas fa-check" /> : n}</div>
                        <div className="step-label">{label}</div>
                    </div>
                );
            })}
        </div>
    );
}

/** Cascarón de modal estilo B152 (backdrop + tira de gradiente). */
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

type ModalName = null | 'passWarn' | 'dist' | 'confirm' | 'limit' | 'success';

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

    // paso 2
    const [n, setN] = useState(5);
    const [k, setK] = useState(3);
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
    const [distPhase, setDistPhase] = useState<'warn' | 'downloading'>('warn');
    const [prog, setProg] = useState({ pct: 0, text: '' });
    const limitTimer = useRef<number | null>(null);

    const runProgress = async (steps: Array<[number, string]>, after: () => void | Promise<void>) => {
        for (const [pct, text] of steps) {
            setProg({ pct, text });
            await sleep(750);
        }
        await sleep(400);
        await after();
    };

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
            .catch((e) => notifyError(getApiErrorMessage(e, 'No se pudo cargar la bóveda.')));
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
            notifyError(getApiErrorMessage(e, 'Pass-phrase incorrecta.'));
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
            // Obligatoria: sin la pass-phrase (ni recuperación por custodios)
            // los activos son irrecuperables. Necesita el PID, así que va
            // justo después de crear la bóveda.
            downloadEmergencySheet({ tipo: 'boveda', nombreBoveda: nombre, pid: b.pid, passphrase });
            setStep(2);
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo crear la bóveda.'));
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
        if (!dek) return;
        setBusy(true);
        try {
            split?.shares.forEach((s) => wipe(s.y)); // descarta un reparto previo
            const r = await splitKey(dek, n, k);
            setSplit(r);
            setXCoords(r.xCoords);
        } catch (e) {
            notifyError((e as Error).message || 'Falló la fragmentación.');
        } finally {
            setBusy(false);
        }
    };

    const submitStep2 = async () => {
        if (!bovedaId || !split) return;
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
            notifyError(getApiErrorMessage(e, 'No se pudieron subir los compromisos.'));
        } finally {
            setBusy(false);
        }
    };

    // --- directorio de custodios: se necesita desde el Paso 2 (validar que haya
    // suficientes verificados antes de fragmentar), no solo en el Paso 3 ---
    useEffect(() => {
        bovedasService
            .listDirectorio()
            .then(setDirectorio)
            .catch((e) => notifyError(getApiErrorMessage(e, 'No se pudo cargar el directorio de custodios.')))
            .finally(() => setLoadingDirectorio(false));
    }, []);

    const toggleCustodio = (id: number) => {
        const c = directorio.find((d) => d.id === id);
        if (c && !custodioNotificable(c)) return; // sin canal verificado
        setSelected((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id);
            if (prev.length >= n) {
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
            notifyError(getApiErrorMessage(e, 'No se pudo confirmar la vinculación.'));
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
        .map((id, i) => ({ c: directorio.find((d) => d.id === id), x: xCoords[i] }))
        .filter((r): r is { c: CustodioResponse; x: number } => Boolean(r.c));

    const notificables = directorio.filter(custodioNotificable);

    // Descarga cada .sss ya nombrado con el custodio que lo recibirá, más
    // commitments.fss. Solo se puede llamar con `split` vivo (recién fragmentado
    // en esta sesión); si se reanuda una bóveda ya fragmentada/distribuida, este
    // paso se omite por completo (ver botón "Vincular y Continuar").
    const downloadAllParaCustodios = async () => {
        if (!split) return;
        for (const { c, x } of selectedCustodios) {
            const s = split.shares.find((sh) => sh.id === x);
            if (!s) continue;
            downloadText(
                `share_${slugNombreArchivo(nombre)}_${slugNombreArchivo(c.nombre)}_x${x}.sss`,
                await encodeShareFile(s.id, s.y),
            );
            await sleep(120);
        }
        downloadText('commitments.fss', await encodeCommitmentsFile(split.commitmentsHex, k));
    };

    // -------------------------------------------------------------------
    if (!resumeReady) {
        return (
            <DashboardLayout activeItem="bovedas" topBarLabel="Configurar Bóveda" backTo="/bovedas">
                <div className="config-card" style={{ maxWidth: 560 }}>
                    <h3 className="fw-bold mb-1">Reanudar configuración</h3>
                    <p className="text-muted">
                        Ingresa la pass-phrase de <strong>{nombre || 'la bóveda'}</strong> para continuar. No se
                        guardó en ningún lado: se vuelve a derivar la llave aquí.
                    </p>
                    <input
                        type="password"
                        className="form-control shadow-none mb-3"
                        placeholder="pass-phrase de la bóveda"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                    />
                    <button className="btn btn-ipn" onClick={handleResumeUnlock} disabled={busy || !passphrase}>
                        {busy ? 'Verificando…' : 'Desbloquear'}
                    </button>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout activeItem="bovedas" topBarLabel="Configurar Nueva Bóveda" backTo="/bovedas">
            <Stepper step={step} />

            {/* ---------- PASO 1 ---------- */}
            {step === 1 && (
                <div className="config-card">
                    <h3 className="fw-bold mb-1">Paso 1: Configuración</h3>
                    <p className="text-muted mb-4">Identidad de la bóveda y su pass-phrase (raíz del cifrado AES-256).</p>

                    <div className="row g-3 mb-3">
                        <div className="col-md-8">
                            <label className="form-label-b d-block">Nombre de la bóveda</label>
                            <input className="form-control shadow-none" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Carteras Frías 2026" />
                        </div>
                        <div className="col-md-4">
                            <label className="form-label-b d-block">Categoría</label>
                            <select className="form-select shadow-none" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                                <option>Finanzas / Crypto</option>
                                <option>Documentos Legales</option>
                                <option>Personal</option>
                                <option>Accesos / Contraseñas</option>
                                <option>Cuentas Digitales</option>
                                <option>Seguros y Beneficiarios</option>
                                <option>Propiedades y Patrimonio</option>
                                <option>Salud</option>
                                <option>Negocios / Empresa</option>
                                <option>Trabajo / Profesional</option>
                                <option>Instrucciones de Sucesión</option>
                                <option>Otro</option>
                            </select>
                        </div>
                    </div>

                    <div className="mb-3">
                        <label className="form-label-b d-block">Mensaje para custodios (opcional)</label>
                        <textarea className="form-control shadow-none" rows={2} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Se mostrará a los custodios durante la recuperación…" />
                    </div>

                    {(() => {
                        const bits = passphraseBits(passphrase);
                        const m = meter(bits);
                        const okToContinue = passphrase.length >= 12 && (bits >= MIN_BITS || passphrase.length >= 30);
                        return (
                            <>
                                <div className="passphrase-box mb-3">
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <label className="form-label-b m-0">Pass-phrase de cifrado (client-side)</label>
                                        <button
                                            type="button"
                                            className="btn btn-sm btn-light"
                                            onClick={() => { setPassphrase(suggestPassphrase()); setShowPass(true); }}
                                        >
                                            <i className="fas fa-dice me-1" /> Sugerir
                                        </button>
                                    </div>
                                    <div className="input-group">
                                        <input
                                            type={showPass ? 'text' : 'password'}
                                            className="form-control shadow-none"
                                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                                            value={passphrase}
                                            onChange={(e) => setPassphrase(e.target.value)}
                                            placeholder="ocho-palabras-al-azar-separadas-por-guion"
                                        />
                                        <button className="btn btn-outline-secondary" type="button" onClick={() => setShowPass((s) => !s)}>
                                            {showPass ? 'Ocultar' : 'Mostrar'}
                                        </button>
                                    </div>
                                    <div className="strength-meter">
                                        <div className="strength-fill" style={{ width: `${m.pct}%`, background: m.color }} />
                                    </div>
                                    {passphrase && (
                                        <div className="d-flex justify-content-between small">
                                            <span style={{ color: m.color, fontWeight: 700 }}>{m.label}</span>
                                            {m.label === 'Débil' && (
                                                <span className="text-muted">usa «Sugerir» para una frase segura</span>
                                            )}
                                        </div>
                                    )}
                                    <p className="m-0 mt-2 text-muted small">
                                        <i className="fas fa-info-circle me-1" /> B152 nunca la guarda. De ella se deriva la
                                        llave AES-256 que además se fragmenta con Shamir.
                                    </p>

                                    <div className="passphrase-warning mt-3">
                                        <i className="fas fa-triangle-exclamation me-2" />
                                        <span>
                                            <strong>Resguardar y recordar esta pass-phrase es tu responsabilidad.</strong>{' '}
                                            Si la pierdes, los activos de la bóveda <strong>no se pueden recuperar</strong>{' '}
                                            hasta que se active el proceso de recuperación con custodios.
                                        </span>
                                    </div>
                                </div>

                                <p className="small mb-4">
                                    <i className="fas fa-file-arrow-down me-1" /> Al continuar se descargará la{' '}
                                    <strong>hoja de emergencia</strong> con la pass-phrase (obligatoria). Imprímela y
                                    guárdala en físico; no la guardes en la nube ni la compartas.
                                </p>

                                <div className="d-flex justify-content-between pt-3 border-top">
                                    <button className="btn btn-light rounded-pill px-4" onClick={() => navigate('/bovedas')}>Cancelar</button>
                                    <button
                                        className="btn btn-ipn"
                                        onClick={() => setModal('passWarn')}
                                        disabled={busy || !nombre || !okToContinue}
                                    >
                                        {busy ? 'Derivando llave…' : 'Continuar a Fragmentación'} <i className="fas fa-arrow-right ms-2" />
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
                    <h3 className="fw-bold mb-1">Paso 2: Fragmentación</h3>
                    <p className="text-muted mb-4">Fragmenta la llave de la bóveda con Shamir (motor WASM). Define n y el umbral k.</p>

                    <div className="sss-control-box mb-4">
                        <div className="row g-4 mb-3">
                            <div className="col-md-6">
                                <div className="d-flex justify-content-between">
                                    <span className="form-label-b">Fragmentos (n)</span>
                                    <span className="slider-value">{n}</span>
                                </div>
                                <input type="range" className="form-range" min={MIN_N} max={10} value={n}
                                    onChange={(e) => {
                                        const nv = Number(e.target.value);
                                        setN(nv);
                                        setK((kv) => Math.min(Math.max(kv, minK(nv)), nv - 1));
                                        setSplit(null);
                                    }} />
                            </div>
                            <div className="col-md-6">
                                <div className="d-flex justify-content-between">
                                    <span className="form-label-b">Umbral (k)</span>
                                    <span className="slider-value">{k}</span>
                                </div>
                                <input type="range" className="form-range" min={minK(n)} max={n - 1} value={k}
                                    onChange={(e) => { setK(Number(e.target.value)); setSplit(null); }} />
                            </div>
                        </div>
                        <div className="logic-hint">
                            <i className="fas fa-shield-alt me-2" />
                            Se generan <strong>{n}</strong> fragmentos; hacen falta <strong>{k}</strong> para reconstruir la llave.
                        </div>
                    </div>

                    {!loadingDirectorio && notificables.length < n && (
                        <p className="text-muted small text-center mb-3">
                            Tienes {notificables.length} custodio{notificables.length === 1 ? '' : 's'} con
                            canal verificado y necesitas {n}.{' '}
                            <button className="btn btn-link p-0 align-baseline" onClick={() => navigate('/custodios')}>
                                Ir a Custodios
                            </button>{' '}
                            o reduce <em>n</em> arriba.
                        </p>
                    )}

                    <div className="text-center mb-4">
                        <button
                            className="btn btn-outline-primary px-5"
                            onClick={doSplit}
                            disabled={busy || loadingDirectorio || notificables.length < n}
                        >
                            <i className="fas fa-microchip me-2" /> {busy ? 'Generando…' : 'Generar Fragmentos'}
                        </button>
                    </div>

                    {split && (
                        <div className="row g-3 mb-3">
                            {split.shares.map((s) => (
                                <div className="col-md-4" key={s.id}>
                                    <div className="share-card">
                                        <div className="d-flex justify-content-between">
                                            <span className="share-id">Fragmento x={s.id}</span>
                                            <i className="fas fa-key text-muted" style={{ fontSize: '0.7rem' }} />
                                        </div>
                                        <div className="share-data">{toHex(s.y).slice(0, 24)}…</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {bovedaPid && (
                        <button className="btn btn-sm btn-outline-secondary rounded-pill mb-3" onClick={descargarHoja}>
                            <i className="fas fa-file-arrow-down me-1" /> Descargar hoja de emergencia
                        </button>
                    )}

                    <div className="d-flex justify-content-between pt-3 border-top">
                        <button className="btn btn-light rounded-pill px-4" onClick={() => setStep(1)} disabled={!!resumeId}>Anterior</button>
                        <button
                            className="btn btn-ipn"
                            onClick={submitStep2}
                            disabled={busy || !split}
                        >
                            {busy ? 'Subiendo compromisos…' : 'Continuar a Vinculación'} <i className="fas fa-arrow-right ms-2" />
                        </button>
                    </div>
                </div>
            )}

            {/* ---------- PASO 3 ---------- */}
            {step === 3 && (
                <div className="config-card">
                    <h3 className="fw-bold mb-1">Paso 3: Vinculación de Custodios</h3>
                    <p className="text-muted mb-3">
                        Elige a quién le entregas cada fragmento. Se empareja en orden con las coordenadas del reparto.
                    </p>

                    <div className="logic-hint mb-4">
                        <i className="fas fa-users me-2" />
                        Debes vincular <strong>los {n} custodios</strong> (uno por fragmento) ·{' '}
                        <strong>{selected.length}/{n}</strong> seleccionados
                        <div className="small mt-1" style={{ opacity: 0.85 }}>
                            Con solo {k} el esquema no tolera fallos: si un custodio pierde su fragmento ya no se
                            alcanza el umbral. Con {n} resiste hasta {n - k} pérdida{n - k === 1 ? '' : 's'}.
                        </div>
                    </div>

                    {(() => {
                        const notificables = directorio.filter(custodioNotificable);
                        const sinVerificar = directorio.length - notificables.length;
                        return (
                            <>
                                {notificables.length < n && (
                                    <p className="text-muted small">
                                        Tienes {notificables.length} custodio{notificables.length === 1 ? '' : 's'} con
                                        canal verificado y necesitas {n}.{' '}
                                        <button className="btn btn-link p-0 align-baseline" onClick={() => navigate('/custodios')}>
                                            Ir a Custodios
                                        </button>{' '}
                                        o vuelve al paso anterior y baja <em>n</em>.
                                    </p>
                                )}
                                {sinVerificar > 0 && (
                                    <p className="small" style={{ color: 'var(--danger-red)' }}>
                                        <i className="fas fa-triangle-exclamation me-1" />
                                        {sinVerificar} custodio{sinVerificar === 1 ? '' : 's'} sin canal verificado no
                                        {sinVerificar === 1 ? ' aparece' : ' aparecen'} como seleccionable —
                                        no podría{sinVerificar === 1 ? '' : 'n'} ser notificado
                                        {sinVerificar === 1 ? '' : 's'} en la recuperación.
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
                                        title={notificable ? '' : 'Sin canal verificado'}
                                    >
                                        <div className="d-flex align-items-center gap-2">
                                            <div className="custodian-avatar">{c.nombre.slice(0, 2).toUpperCase()}</div>
                                            <div className="flex-grow-1">
                                                <p className="m-0 fw-bold small">{c.nombre}</p>
                                                <p className="m-0 text-muted" style={{ fontSize: '0.65rem' }}>{c.correo}</p>
                                            </div>
                                            {isSel && <span className="x-chip">x={xCoords[pos]}</span>}
                                            {!notificable && <span className="no-verif-chip">sin verificar</span>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="d-flex justify-content-between pt-3 border-top">
                        <button className="btn btn-light rounded-pill px-4" onClick={() => setStep(2)} disabled={!!resumeId}>Anterior</button>
                        <button
                            className="btn btn-ipn"
                            onClick={() => setModal('confirm')}
                            disabled={busy || selected.length !== n}
                        >
                            Confirmar Vinculación <i className="fas fa-arrow-right ms-2" />
                        </button>
                    </div>
                </div>
            )}

            {/* ---------- PASO 4 (respaldo tras el modal) ---------- */}
            {step === 4 && (
                <div className="config-card text-center">
                    <div className="mb-3" style={{ color: 'var(--escom-blue)' }}><i className="fas fa-check-circle fa-3x" /></div>
                    <h3 className="fw-bold">Bóveda configurada</h3>
                    <p className="text-muted">Redirigiendo a Mis Bóvedas…</p>
                    <button className="btn btn-ipn mt-2" onClick={() => navigate('/bovedas')}>Ir ahora</button>
                </div>
            )}

            {/* ═══════════════ MODALES ═══════════════ */}

            {modal === 'passWarn' && (
                <WizardModal>
                    <div className="mb-3 text-warning">
                        <i className="fas fa-shield-virus fa-4x animate__animated animate__pulse animate__infinite" />
                    </div>
                    <h4 className="fw-bold">¡Resguarda tu Frase Maestra!</h4>
                    <p className="text-muted small mb-3">
                        Esta pass-phrase cifra tus activos localmente. <strong>Sin ella, tus archivos serán ilegibles
                        para siempre.</strong> Al continuar se descargará tu hoja de emergencia con ella.
                    </p>
                    <div className="bg-light p-3 rounded-3 mb-4 text-start">
                        <p className="small fw-bold mb-1 text-muted text-uppercase">Tu frase:</p>
                        <code className="fw-bold" style={{ fontSize: '1.05rem', wordBreak: 'break-all' }}>{passphrase}</code>
                    </div>
                    <div className="d-flex gap-3">
                        <button className="btn btn-light w-100 rounded-pill" onClick={() => setModal(null)}>Regresar</button>
                        <button
                            className="btn btn-ipn w-100"
                            onClick={async () => { setModal(null); await submitStep1(); }}
                        >
                            Continuar y descargar hoja
                        </button>
                    </div>
                </WizardModal>
            )}

            {modal === 'dist' && (
                <WizardModal>
                    {distPhase === 'warn' ? (
                        <>
                            <div className="mb-3 text-warning">
                                <i className="fas fa-paper-plane fa-4x animate__animated animate__tada animate__infinite" />
                            </div>
                            <h4 className="fw-bold">Distribución de Fragmentos</h4>
                            <p className="text-muted small mb-3">
                                La seguridad depende de que los fragmentos <strong>no se almacenen juntos</strong>. Es tu
                                responsabilidad entregarlos de forma segura.
                            </p>
                            <div className="bg-light p-3 rounded-3 mb-4 text-start small">
                                <ul className="text-muted ps-3 mb-0">
                                    <li>Entrega en persona o por canal cifrado.</li>
                                    <li>Cada custodio resguarda su fragmento por separado.</li>
                                    <li className="mt-2 text-danger fw-bold">
                                        Al continuar se descargarán todos los fragmentos en este equipo.
                                    </li>
                                </ul>
                            </div>
                            <div className="d-flex gap-3">
                                <button className="btn btn-light w-100 rounded-pill" onClick={() => setModal(null)}>
                                    Revisar fragmentos
                                </button>
                                <button
                                    className="btn btn-ipn w-100"
                                    onClick={async () => {
                                        setDistPhase('downloading');
                                        await downloadAllParaCustodios();
                                        await runProgress(
                                            [
                                                [30, 'Compilando fragmentos criptográficos…'],
                                                [70, 'Preparando descarga local…'],
                                                [100, 'Descarga completada.'],
                                            ],
                                            async () => { setModal(null); await submitStep3(); },
                                        );
                                    }}
                                >
                                    Aceptar y Descargar
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="mb-3 text-primary">
                                <i className="fas fa-cloud-download-alt fa-4x animate__animated animate__bounce animate__infinite" />
                            </div>
                            <h4 className="fw-bold">Descargando Fragmentos</h4>
                            <p className="text-muted small">{prog.text || 'Generando archivos .sss…'}</p>
                            <div className="wizard-progress">
                                <div className="wizard-progress-bar" style={{ width: `${prog.pct}%` }} />
                            </div>
                        </>
                    )}
                </WizardModal>
            )}

            {modal === 'confirm' && (
                <WizardModal>
                    <div className="mb-3 text-primary"><i className="fas fa-clipboard-check fa-3x" /></div>
                    <h4 className="fw-bold">Confirmar Selección</h4>
                    <p className="text-muted small mb-3">
                        Estos custodios recibirán un fragmento y serán los responsables de la recuperación.
                    </p>
                    <div className="mb-4">
                        {selectedCustodios.map(({ c, x }) => (
                            <div className="confirm-list-item" key={c.id}>
                                <div className="custodian-avatar" style={{ width: 34, height: 34, fontSize: '0.7rem' }}>
                                    {c.nombre.slice(0, 2).toUpperCase()}
                                </div>
                                <div className="text-start flex-grow-1">
                                    <p className="m-0 fw-bold small">{c.nombre}</p>
                                    <p className="m-0 text-muted" style={{ fontSize: '0.6rem' }}>{c.correo}</p>
                                </div>
                                <span className="x-chip">x={x}</span>
                            </div>
                        ))}
                    </div>
                    <div className="d-flex gap-3">
                        <button className="btn btn-light w-100 rounded-pill" onClick={() => setModal(null)}>Modificar</button>
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
                            {split ? 'Continuar a Distribución' : 'Vincular y Continuar'}
                        </button>
                    </div>
                </WizardModal>
            )}

            {modal === 'limit' && (
                <WizardModal>
                    <div className="mb-3 text-warning">
                        <i className="fas fa-users-slash fa-4x animate__animated animate__shakeX" />
                    </div>
                    <h4 className="fw-bold">Límite Alcanzado</h4>
                    <p className="text-muted small mb-0">
                        El esquema es de {n} fragmentos. No puedes asignar más de {n} custodios.
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
                    <h4 className="fw-bold">¡Bóveda Lista!</h4>
                    <p className="text-muted small mb-0">
                        Compromisos VSS almacenados y {n} custodios vinculados. Redirigiendo a Mis Bóvedas…
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
