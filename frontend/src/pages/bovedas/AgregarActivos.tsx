import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { bovedasService } from '../../services/bovedas.service';
import { activosService } from '../../services/activos.service';
import type { BovedaResponse } from '../../types/bovedas.types';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import { deriveFromEnvelope } from '../../crypto/vaultCrypto';
import { wipe } from '../../crypto/sensitiveMemory';
import { encryptFile, humanBytes, MAX_FILE_BYTES } from '../../crypto/assetCrypto';
import { withMinDelay } from '../../utils/progress';
import StorageMeter from '../../components/StorageMeter';
import './bovedas.css';

const GCM_OVERHEAD = 16; // bytes de tag por archivo

export default function AgregarActivos() {
    const { id } = useParams();
    const bid = Number(id);
    const navigate = useNavigate();

    const [boveda, setBoveda] = useState<BovedaResponse | null>(null);
    const { notifyError, notifySuccess } = useNotice();
    // cuántos activos se subieron ya en esta sesión (sin salir de la pantalla) —
    // determina si el botón de salida dice "Cancelar" o "Finalizar".
    const [subidos, setSubidos] = useState(0);

    // gate de pass-phrase → DEK en memoria para el lote
    const [passphrase, setPassphrase] = useState('');
    const [dek, setDek] = useState<Uint8Array | null>(null);
    const [verifier, setVerifier] = useState('');
    const [unlocking, setUnlocking] = useState(false);

    const [files, setFiles] = useState<File[]>([]);
    const [dragOver, setDragOver] = useState(false);

    // nombres ya existentes en la bóveda, para avisar de duplicados al elegir archivos
    const [nombresExistentes, setNombresExistentes] = useState<Set<string>>(new Set());
    // si no es null, hay duplicados sin resolver: el modal bloquea hasta que
    // el usuario elija "omitir" o "cancelar".
    const [dupModal, setDupModal] = useState<string[] | null>(null);

    // progreso
    const [running, setRunning] = useState(false);
    const [prog, setProg] = useState({ pct: 0, text: '', done: false });

    // refs para el guard de navegación:
    //  - mientras `running`, un beforeunload frena cerrar/recargar la pestaña.
    //  - si el componente se desmonta con la subida en curso NO se borra la
    //    DEK: el lote sigue corriendo hasta terminar y la borra él mismo.
    const dekRef = useRef<Uint8Array | null>(null);
    const runningRef = useRef(false);
    const mountedRef = useRef(true);
    useEffect(() => { dekRef.current = dek; }, [dek]);
    useEffect(() => { runningRef.current = running; }, [running]);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (!runningRef.current) wipe(dekRef.current);
        };
    }, []);
    useEffect(() => {
        if (!running) return;
        const warn = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [running]);

    useEffect(() => {
        bovedasService
            .get(bid)
            .then(setBoveda)
            .catch((e) => notifyError(getApiErrorMessage(e, 'No se pudo cargar la bóveda.')));
        // solo metadatos (nombres); no requiere pass-phrase
        activosService
            .list(bid)
            .then((lista) => setNombresExistentes(new Set(lista.map((a) => a.nombre_original.toLowerCase()))))
            .catch(() => {
                /* si falla, simplemente no se advierten duplicados */
            });
    }, [bid]);

    const unlock = async () => {
        if (!boveda) return;
        setUnlocking(true);
        try {
            const { dek: d, verifier: v } = await deriveFromEnvelope(passphrase, boveda.kdf);
            await bovedasService.verifyPassphrase(bid, v); // 403 si es incorrecta
            setDek(d);
            setVerifier(v);
        } catch (e) {
            wipe(dekRef.current);
            notifyError(getApiErrorMessage(e, 'Pass-phrase incorrecta.'));
        } finally {
            setUnlocking(false);
        }
    };

    const addFiles = (list: FileList | File[]) => {
        const nuevos = Array.from(list).filter((f) => f.size > 0);
        const yaEnCola = new Set(files.map((f) => f.name.toLowerCase()));
        const duplicados = nuevos.filter(
            (f) => nombresExistentes.has(f.name.toLowerCase()) || yaEnCola.has(f.name.toLowerCase()),
        );
        setFiles((prev) => {
            const map = new Map(prev.map((f) => [`${f.name}:${f.size}`, f]));
            for (const f of nuevos) map.set(`${f.name}:${f.size}`, f);
            return [...map.values()];
        });
        if (duplicados.length > 0) setDupModal(duplicados.map((f) => f.name));
    };

    // Quita de la cola solo los archivos cuyo nombre ya existe en la bóveda.
    const omitirDuplicados = () => {
        setFiles((prev) => prev.filter((f) => !nombresExistentes.has(f.name.toLowerCase())));
        setDupModal(null);
    };

    // Cancela toda la selección actual (equivale a empezar de cero).
    const cancelarSeleccion = () => {
        setFiles([]);
        setDupModal(null);
        const input = document.getElementById('activoInput') as HTMLInputElement | null;
        if (input) input.value = '';
    };

    const usado = boveda?.usado_bytes ?? 0;
    const cuota = boveda?.cuota_bytes ?? 0;
    const nuevoTotal = files.reduce((s, f) => s + f.size + GCM_OVERHEAD, 0);
    const excede = cuota > 0 && usado + nuevoTotal > cuota;
    const demasiadoGrandes = files.filter((f) => f.size + GCM_OVERHEAD > MAX_FILE_BYTES);

    const subir = async () => {
        if (!dek || files.length === 0 || demasiadoGrandes.length > 0) return;
        setRunning(true);
        setProg({ pct: 0, text: 'Preparando…', done: false });
        const lote = files; // snapshot: se limpia `files` en cuanto termina el lote
        let cifradoSubido = 0;
        try {
            for (let i = 0; i < lote.length; i++) {
                const f = lote[i];
                const base = Math.round((i / lote.length) * 100);
                setProg({ pct: base + 5, text: `Cifrando ${f.name}…`, done: false });
                let enc;
                try {
                    enc = await withMinDelay(encryptFile(dek, f));
                } catch (encErr) {
                    // Errores de cifrado (p. ej. límites del navegador) no son
                    // AxiosError: getApiErrorMessage siempre caería al mensaje
                    // genérico. Se antepone el nombre del archivo y el motivo real.
                    const motivo = encErr instanceof Error ? encErr.message : String(encErr);
                    throw new Error(`No se pudo cifrar "${f.name}" en el navegador: ${motivo}`);
                }

                setProg({ pct: base + 15, text: `Reservando espacio para ${f.name}…`, done: false });
                const ini = await withMinDelay(
                    activosService.iniciar(bid, {
                        passphrase_verifier: verifier,
                        nombre: f.name,
                        mime: f.type || null,
                        tamano_bytes: enc.tamanoBytes,
                        tamano_cifrado: enc.tamanoCifrado,
                        iv_hex: enc.ivHex,
                        sha256_plano: enc.sha256Hex,
                    }),
                );

                setProg({ pct: base + 25, text: `Subiendo ${f.name}…`, done: false });
                await withMinDelay(activosService.putBlob(ini.sas_url, enc.ciphertext));

                setProg({ pct: base + 32, text: `Confirmando ${f.name}…`, done: false });
                await withMinDelay(activosService.confirmar(bid, ini.activo_id, verifier));
                cifradoSubido += enc.tamanoCifrado;
            }
            // lote terminado: la DEK se conserva — el usuario puede seguir
            // subiendo más activos sin volver a escribir la pass-phrase.
            setProg({ pct: 100, text: 'Activos agregados.', done: true });
            setTimeout(() => {
                if (!mountedRef.current) return;
                setRunning(false);
                setFiles([]);
                const input = document.getElementById('activoInput') as HTMLInputElement | null;
                if (input) input.value = '';
                setNombresExistentes((prev) => {
                    const next = new Set(prev);
                    lote.forEach((f) => next.add(f.name.toLowerCase()));
                    return next;
                });
                setBoveda((b) => (b ? { ...b, usado_bytes: b.usado_bytes + cifradoSubido } : b));
                setSubidos((n) => n + lote.length);
                notifySuccess(
                    lote.length === 1
                        ? '1 activo agregado correctamente. Puedes seguir subiendo más.'
                        : `${lote.length} activos agregados correctamente. Puedes seguir subiendo más.`,
                );
            }, 1200);
        } catch (e) {
            // en error se conserva la DEK para que el usuario pueda reintentar
            setRunning(false);
            // Un error local (cifrado, red sin respuesta HTTP) no trae
            // e.response: getApiErrorMessage lo detecta y usa su propio
            // mensaje en vez de caer siempre al genérico.
            const esErrorLocal = e instanceof Error && !(e as { response?: unknown }).response;
            notifyError(
                esErrorLocal
                    ? e.message
                    : getApiErrorMessage(e, 'No se pudieron agregar los activos.'),
            );
        }
    };

    // ---------------------------------------------------------------
    if (!dek) {
        return (
            <DashboardLayout activeItem="bovedas" topBarLabel="Agregar activos" backTo={`/bovedas/${bid}`}>
                <div className="config-card" style={{ maxWidth: 560 }}>
                    <h3 className="fw-bold mb-1">Confirmar llave maestra</h3>
                    <p className="text-muted small">
                        Los archivos se cifran localmente con la pass-phrase de la bóveda antes de subirse.
                    </p>
                    <input
                        type="password"
                        className="form-control shadow-none mb-3"
                        placeholder="pass-phrase de la bóveda"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                    />
                    <button className="btn btn-ipn" onClick={unlock} disabled={unlocking || !passphrase}>
                        {unlocking ? 'Verificando…' : 'Desbloquear'}
                    </button>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout activeItem="bovedas" topBarLabel="Agregar activos" backTo={`/bovedas/${bid}`}>
            <div className="config-card">
                <div className="mb-4 text-center">
                    <h3 className="fw-bold mb-1">Agregar nuevos activos</h3>
                    <p className="text-muted">
                        Se cifran localmente con AES-256-GCM y se suben directo al almacenamiento. Kleimos nunca ve el
                        contenido.
                    </p>
                </div>

                <div className="storage-card mb-4">
                    <StorageMeter
                        usado={usado}
                        cuota={cuota}
                        note={
                            files.length > 0 ? (
                                <span className={excede ? 'text-danger fw-bold' : undefined}>
                                    + {humanBytes(nuevoTotal)} en {files.length} archivo(s)
                                    {excede ? ' — excede tu cuota' : ''}
                                </span>
                            ) : undefined
                        }
                    />
                </div>

                <div
                    className={`upload-zone ${dragOver ? 'dragover' : ''}`}
                    onClick={() => document.getElementById('activoInput')?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                >
                    <input id="activoInput" type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
                    <i className="fas fa-cloud-arrow-up upload-icon" />
                    <h5 className="fw-bold m-0">Arrastra tus archivos aquí</h5>
                    <p className="text-muted small m-0">o haz clic para elegirlos</p>
                    <p className="m-0 mt-2 small fw-bold" style={{ color: 'var(--escom-blue)' }}>
                        <i className="fas fa-shield-alt me-1" /> Cifrado AES-256-GCM en el navegador
                    </p>
                </div>

                {dupModal && (
                    <p className="text-danger small fw-bold mt-3 mb-0">
                        <i className="fas fa-triangle-exclamation me-1" />
                        Resuelve los nombres duplicados para continuar.
                    </p>
                )}

                {demasiadoGrandes.length > 0 && (
                    <p className="text-danger small fw-bold mt-3 mb-0">
                        <i className="fas fa-triangle-exclamation me-1" />
                        {demasiadoGrandes.length === 1
                            ? '1 archivo supera'
                            : `${demasiadoGrandes.length} archivos superan`}{' '}
                        el máximo de {humanBytes(MAX_FILE_BYTES)} por archivo — el cifrado en el navegador no
                        soporta archivos más grandes. Quítalo{demasiadoGrandes.length === 1 ? '' : 's'} para continuar.
                    </p>
                )}

                {files.length > 0 && (
                    <div className="mt-3">
                        {files.map((f) => {
                            const esDuplicado = nombresExistentes.has(f.name.toLowerCase());
                            const esDemasiadoGrande = f.size + GCM_OVERHEAD > MAX_FILE_BYTES;
                            return (
                            <div className="file-item" key={`${f.name}:${f.size}`}>
                                <div className="file-icon"><i className="fas fa-file-shield" /></div>
                                <div className="flex-grow-1">
                                    <p className="m-0 fw-bold small d-flex align-items-center gap-2">
                                        {f.name}
                                        {esDuplicado && <span className="dup-chip">YA EXISTE</span>}
                                        {esDemasiadoGrande && <span className="dup-chip">DEMASIADO GRANDE</span>}
                                    </p>
                                    <p
                                        className={esDemasiadoGrande ? 'm-0 text-danger fw-bold' : 'm-0 text-muted'}
                                        style={{ fontSize: '0.65rem' }}
                                    >
                                        {humanBytes(f.size)}
                                        {esDemasiadoGrande ? ` — máx. ${humanBytes(MAX_FILE_BYTES)}` : ''}
                                    </p>
                                </div>
                                <button
                                    className="btn btn-sm btn-link text-muted"
                                    onClick={() => setFiles((p) => p.filter((x) => x !== f))}
                                    aria-label="Quitar"
                                >
                                    <i className="fas fa-times" />
                                </button>
                            </div>
                            );
                        })}
                    </div>
                )}

                <div className="d-flex justify-content-between pt-4 mt-3 border-top">
                    <button
                        className="btn btn-light rounded-pill px-4"
                        onClick={() => navigate(`/bovedas/${bid}`)}
                        disabled={running}
                    >
                        {subidos > 0 ? (
                            <><i className="fas fa-check me-2" />Finalizar</>
                        ) : (
                            'Cancelar'
                        )}
                    </button>
                    <button
                        className="btn btn-ipn px-5"
                        onClick={subir}
                        disabled={running || files.length === 0 || excede || demasiadoGrandes.length > 0 || dupModal !== null}
                    >
                        Cifrar y agregar <i className="fas fa-lock ms-2" />
                    </button>
                </div>
            </div>

            {running && (
                <div className="modal fade show d-block wizard-modal" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" style={prog.done ? { background: 'var(--escom-blue)' } : undefined} />
                            <div className="modal-body p-5 text-center">
                                <div className="mb-3">
                                    {prog.done ? (
                                        <i className="fas fa-check-circle fa-3x animate__animated animate__bounceIn" style={{ color: 'var(--escom-blue)' }} />
                                    ) : prog.text.startsWith('Cifrando') ? (
                                        <i className="fas fa-lock fa-beat fa-3x" style={{ color: 'var(--ipn-maroon)' }} />
                                    ) : (
                                        <i className="fas fa-sync fa-spin fa-3x text-primary" />
                                    )}
                                </div>
                                <h4 className="fw-bold">
                                    {prog.done
                                        ? 'Activos agregados'
                                        : prog.text.startsWith('Cifrando')
                                          ? 'Cifrando localmente (AES-256-GCM)'
                                          : 'Cifrando y subiendo'}
                                </h4>
                                <p className="text-muted small">{prog.text}</p>
                                <div className="wizard-progress mt-3">
                                    <div className="wizard-progress-bar" style={{ width: `${prog.pct}%` }} />
                                </div>
                                {!prog.done && (
                                    <p className="text-muted mt-3 mb-0" style={{ fontSize: '0.72rem' }}>
                                        <i className="fas fa-triangle-exclamation me-1" />
                                        No cierres ni recargues esta pestaña hasta que termine.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {dupModal && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.65)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" style={{ background: 'var(--warning-amber)' }} />
                            <div className="modal-body p-5 text-center">
                                <div className="mb-3" style={{ color: 'var(--warning-amber)' }}>
                                    <i className="fas fa-triangle-exclamation fa-3x animate__animated animate__headShake" />
                                </div>
                                <h4 className="fw-bold">Nombre duplicado</h4>
                                <p className="text-muted small mb-1">
                                    {dupModal.length === 1
                                        ? 'Ya existe un archivo con este nombre en la bóveda:'
                                        : `Ya existen ${dupModal.length} archivos con estos nombres en la bóveda:`}
                                </p>
                                <ul className="text-start small mx-auto mb-3" style={{ maxWidth: 320 }}>
                                    {dupModal.map((n) => (
                                        <li key={n} className="fw-bold">{n}</li>
                                    ))}
                                </ul>
                                <p className="text-muted small">¿Qué quieres hacer antes de continuar?</p>
                                <div className="d-flex flex-column gap-2 mt-3">
                                    <button className="btn w-100 rounded-pill text-white" style={{ background: 'var(--warning-amber)' }} onClick={omitirDuplicados}>
                                        Omitir duplicados y seguir con el resto
                                    </button>
                                    <button className="btn btn-outline-secondary w-100 rounded-pill" onClick={() => setDupModal(null)}>
                                        Subir de todos modos (como copia)
                                    </button>
                                    <button className="btn btn-light w-100 rounded-pill" onClick={cancelarSeleccion}>
                                        Cancelar toda la selección
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}