import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DashboardLayout from '../../components/layout/DashboardLayout';
import { bovedasService } from '../../services/bovedas.service';
import type { BovedaResponse, CustodioResponse, CustodioBovedaResponse, VssResponse } from '../../types/bovedas.types';
import { bovedaBadge } from '../../types/bovedas.types';
import { custodioNotificable } from '../../types/custodios.types';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import { parseBackendDate } from '../../utils/dates';
import { deriveVerifier, deriveFromEnvelope } from '../../crypto/vaultCrypto';
import { wipe } from '../../crypto/sensitiveMemory';
import { decryptToBlob, saveBlob, humanBytes } from '../../crypto/assetCrypto';
import { decodeShareFile, verifyShare, encodeShareFile, downloadText, slugNombreArchivo, type Share } from '../../crypto/sss';
import { activosService } from '../../services/activos.service';
import type { ActivoResponse } from '../../types/activos.types';
import StorageMeter from '../../components/StorageMeter';
import CredentialEditorModal from '../../credentials/CredentialEditorModal';
import CredentialViewModal from '../../credentials/CredentialViewModal';
import { parseEnvelope, plantillaById, type CredentialEnvelope } from '../../credentials/templates';
import './bovedas.css';

const ASSETS_PER_PAGE = 6;

/** Separa nombre base y extensión preservando mayúsculas/minúsculas originales. */
function splitNombre(nombre: string): { base: string; ext: string } {
    const i = nombre.lastIndexOf('.');
    if (i <= 0 || i === nombre.length - 1) return { base: nombre, ext: '' };
    return { base: nombre.slice(0, i), ext: nombre.slice(i + 1) };
}

/** Extensión en mayúsculas a partir del nombre original (ej. "PDF", "JPG").
 *  Sirve para distinguir de un vistazo archivos con el mismo nombre visible. */
function extensionOf(nombre: string): string {
    return splitNombre(nombre).ext.toUpperCase();
}

/** Fecha corta + hora para la lista de activos (ej. "3 sep 2026, 14:22"). */
function formatFechaActivo(iso: string | null): string {
    if (!iso) return '';
    return parseBackendDate(iso).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

interface Asignacion {
    id_custodio: number;
    x_fragmento: number;
}

type Cambio =
    | { tipo: 'nuevo'; id_custodio: number; nueva: number }
    | { tipo: 'cambio'; id_custodio: number; anterior: number; nueva: number }
    | { tipo: 'baja'; id_custodio: number; anterior: number };

const desdeVinculados = (filas: CustodioBovedaResponse[]): Asignacion[] =>
    filas.map((f) => ({ id_custodio: f.id_custodio, x_fragmento: f.x_fragmento }));

/** Qué cambia respecto a lo guardado, para mostrarlo antes de confirmar. */
function diferencias(guardadas: CustodioBovedaResponse[], nuevas: Asignacion[]): Cambio[] {
    const antes = new Map(guardadas.map((g) => [g.id_custodio, g.x_fragmento]));
    const despues = new Map(nuevas.map((a) => [a.id_custodio, a.x_fragmento]));
    const cambios: Cambio[] = [];
    for (const [id, nueva] of despues) {
        const anterior = antes.get(id);
        if (anterior === undefined) cambios.push({ tipo: 'nuevo', id_custodio: id, nueva });
        else if (anterior !== nueva) cambios.push({ tipo: 'cambio', id_custodio: id, anterior, nueva });
    }
    for (const [id, anterior] of antes) {
        if (!despues.has(id)) cambios.push({ tipo: 'baja', id_custodio: id, anterior });
    }
    return cambios;
}

export default function GestionarBoveda() {
    const { id } = useParams();
    const bid = Number(id);
    const navigate = useNavigate();

    const [boveda, setBoveda] = useState<BovedaResponse | null>(null);
    const [vss, setVss] = useState<VssResponse | null>(null);
    const [vinculados, setVinculados] = useState<CustodioBovedaResponse[]>([]);
    const [directorio, setDirectorio] = useState<CustodioResponse[]>([]);
    const [loadFailed, setLoadFailed] = useState(false);
    const { notifyError, notifySuccess } = useNotice();

    // CU-027: guardia de pass-phrase
    const [passphrase, setPassphrase] = useState('');
    const [verifier, setVerifier] = useState('');
    const [unlocking, setUnlocking] = useState(false);
    const unlocked = Boolean(verifier);

    // edición de metadatos
    const [nombre, setNombre] = useState('');
    const [mensaje, setMensaje] = useState('');
    const [saving, setSaving] = useState(false);

    // re-vinculación: cada custodio conserva la x que YA tiene asignada (es la
    // del fragmento .sss que tiene en su poder); nunca se deriva de la posición.
    const [asignacion, setAsignacion] = useState<Asignacion[]>([]);
    const [linking, setLinking] = useState(false);

    // verificación del fragmento físico antes de guardar una re-vinculación. La
    // descarga renombrada NO ocurre al verificar: se guarda el share en memoria y
    // solo se descarga (y se borra) al confirmar el lote completo.
    const [renombrarAbierto, setRenombrarAbierto] = useState(false);
    const [subidas, setSubidas] = useState<Record<number, 'pendiente' | 'verificando' | 'ok' | 'error'>>({});
    const [fragmentosVerificados, setFragmentosVerificados] = useState<Record<number, Share>>({});
    const fragmentosVerificadosRef = useRef<Record<number, Share>>({});
    useEffect(() => {
        fragmentosVerificadosRef.current = fragmentosVerificados;
    }, [fragmentosVerificados]);
    useEffect(
        () => () => {
            Object.values(fragmentosVerificadosRef.current).forEach((s) => wipe(s.y));
        },
        [],
    );

    // activos digitales
    const [activos, setActivos] = useState<ActivoResponse[]>([]);
    const [busyActivoId, setBusyActivoId] = useState<number | null>(null);
    const [toDeleteActivo, setToDeleteActivo] = useState<ActivoResponse | null>(null);
    const [assetSearch, setAssetSearch] = useState('');
    const [assetPage, setAssetPage] = useState(1);

    const filteredActivos = useMemo(() => {
        const q = assetSearch.trim().toLowerCase();
        if (!q) return activos;
        return activos.filter((a) => a.nombre_original.toLowerCase().includes(q));
    }, [activos, assetSearch]);

    // Cuando dos archivos comparten el mismo nombre visible (ej. subiste el
    // mismo "share_231.sss" dos veces) numera los repetidos para distinguirlos:
    // el más antiguo conserva el nombre tal cual, los siguientes se muestran
    // como "share_231 (1).sss", "share_231 (2).sss"… Solo afecta lo que se
    // ve en pantalla, no el nombre real del archivo.
    const displayNombreById = useMemo(() => {
        const grupos = new Map<string, ActivoResponse[]>();
        for (const a of activos) {
            const key = a.nombre_original.toLowerCase();
            const arr = grupos.get(key) ?? [];
            arr.push(a);
            grupos.set(key, arr);
        }
        const map = new Map<number, string>();
        for (const arr of grupos.values()) {
            if (arr.length === 1) continue; // nombre único: se muestra tal cual
            const ordenados = [...arr].sort((x, y) => {
                const tx = x.created_at ? parseBackendDate(x.created_at).getTime() : 0;
                const ty = y.created_at ? parseBackendDate(y.created_at).getTime() : 0;
                return tx - ty; // el más antiguo primero
            });
            ordenados.forEach((a, i) => {
                if (i === 0) return;
                const { base, ext } = splitNombre(a.nombre_original);
                map.set(a.id, ext ? `${base} (${i}).${ext}` : `${base} (${i})`);
            });
        }
        return map;
    }, [activos]);

    const totalAssetPages = Math.max(1, Math.ceil(filteredActivos.length / ASSETS_PER_PAGE));
    const currentAssetPage = Math.min(assetPage, totalAssetPages);
    const pagedActivos = filteredActivos.slice(
        (currentAssetPage - 1) * ASSETS_PER_PAGE,
        currentAssetPage * ASSETS_PER_PAGE,
    );

    // plantillas de credenciales
    type EditorState =
        | { modo: 'crear' }
        | { modo: 'editar'; activo: ActivoResponse; envelope: CredentialEnvelope };
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [viewer, setViewer] = useState<{ activo: ActivoResponse; envelope: CredentialEnvelope } | null>(null);

    const reload = async () => {
        const b = await bovedasService.get(bid);
        setBoveda(b);
        setNombre(b.nombre);
        setMensaje(b.mensaje_custodios ?? '');
        setVinculados(await bovedasService.listCustodiosVinculados(bid));
        try {
            setVss(await bovedasService.getVss(bid));
        } catch {
            setVss(null);
        }
    };

    useEffect(() => {
        reload().catch((e) => {
            setLoadFailed(true);
            notifyError(getApiErrorMessage(e, 'No se pudo cargar la bóveda.'));
        });
    }, [bid]);

    const unlock = async () => {
        if (!boveda) return;
        setUnlocking(true);
        try {
            const v = await deriveVerifier(passphrase, boveda.kdf); // deriva, valida y borra la DEK
            await bovedasService.verifyPassphrase(bid, v); // 403 si es incorrecta
            setVerifier(v);
            setDirectorio(await bovedasService.listDirectorio());
            setAsignacion(desdeVinculados(vinculados));
            setActivos(await activosService.list(bid));
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'Pass-phrase incorrecta.'));
        } finally {
            setUnlocking(false);
        }
    };

    const saveMeta = async () => {
        setSaving(true);
        try {
            const b = await bovedasService.update(bid, {
                passphrase_verifier: verifier,
                nombre,
                mensaje_custodios: mensaje || null,
            });
            setBoveda(b);
            notifySuccess('Metadatos actualizados.');
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo actualizar.'));
        } finally {
            setSaving(false);
        }
    };

    const xCoords = vss?.x_coords ?? [];
    const n = boveda?.total_fragmentos_n ?? 0;
    const k = boveda?.umbral_k ?? 0;

    const xDe = (cid: number) => asignacion.find((a) => a.id_custodio === cid)?.x_fragmento;
    const cambios = useMemo(() => diferencias(vinculados, asignacion), [vinculados, asignacion]);
    const nombreDe = (cid: number) =>
        directorio.find((d) => d.id === cid)?.nombre ??
        vinculados.find((v) => v.id_custodio === cid)?.nombre ??
        `#${cid}`;

    // 'nuevo'/'cambio' tienen una x física que entregar; 'baja' no necesita archivo.
    const pendientesRenombrar = cambios.filter(
        (c): c is Extract<Cambio, { tipo: 'nuevo' | 'cambio' }> => c.tipo !== 'baja',
    );

    // Solo valida y guarda el share en memoria; la descarga renombrada ocurre
    // hasta confirmar el lote completo (ver confirmarRenombradoYGuardar).
    const subirFragmentoRenombrado = async (item: Extract<Cambio, { tipo: 'nuevo' | 'cambio' }>, file: File) => {
        setSubidas((prev) => ({ ...prev, [item.id_custodio]: 'verificando' }));
        try {
            const texto = await file.text();
            const share = await decodeShareFile(texto);
            if (share.id !== item.nueva || !vss?.commitments_hex || !(await verifyShare(share, vss.commitments_hex))) {
                wipe(share.y);
                throw new Error();
            }
            setFragmentosVerificados((prev) => ({ ...prev, [item.id_custodio]: share }));
            setSubidas((prev) => ({ ...prev, [item.id_custodio]: 'ok' }));
        } catch {
            setSubidas((prev) => ({ ...prev, [item.id_custodio]: 'error' }));
        }
    };

    const cerrarModalRenombrar = () => {
        // Se cancela sin confirmar: ningún fragmento verificado llegó a
        // descargarse, así que basta borrar lo que haya quedado en memoria.
        Object.values(fragmentosVerificados).forEach((s) => wipe(s.y));
        setFragmentosVerificados({});
        setRenombrarAbierto(false);
    };

    const confirmarRenombradoYGuardar = async () => {
        for (const item of pendientesRenombrar) {
            const share = fragmentosVerificados[item.id_custodio];
            if (!share) continue;
            downloadText(
                `share_${slugNombreArchivo(boveda?.nombre ?? '')}_${slugNombreArchivo(nombreDe(item.id_custodio))}_x${item.nueva}.sss`,
                await encodeShareFile(share.id, share.y),
            );
            wipe(share.y);
        }
        setFragmentosVerificados({});
        setRenombrarAbierto(false);
        await saveLinks();
    };

    const onClickGuardarVinculacion = () => {
        if (pendientesRenombrar.length === 0) {
            saveLinks();
            return;
        }
        setSubidas(Object.fromEntries(pendientesRenombrar.map((p) => [p.id_custodio, 'pendiente'])));
        setFragmentosVerificados({});
        setRenombrarAbierto(true);
    };

    const toggle = (cid: number) => {
        const c = directorio.find((d) => d.id === cid);
        if (c && !custodioNotificable(c)) return; // sin canal verificado
        setAsignacion((prev) => {
            if (prev.some((a) => a.id_custodio === cid)) return prev.filter((a) => a.id_custodio !== cid);
            // Al vincular, recibe la primera x que quedó libre.
            const libre = xCoords.find((x) => !prev.some((a) => a.x_fragmento === x));
            return libre === undefined ? prev : [...prev, { id_custodio: cid, x_fragmento: libre }];
        });
    };

    const saveLinks = async () => {
        setLinking(true);
        try {
            const rows = await bovedasService.setCustodios(bid, {
                passphrase_verifier: verifier,
                asignaciones: asignacion,
            });
            setVinculados(rows);
            setAsignacion(desdeVinculados(rows));
            setBoveda(await bovedasService.get(bid));
            notifySuccess('Vinculaciones actualizadas.');
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo re-vincular.'));
        } finally {
            setLinking(false);
        }
    };

    // --- activos ---
    const descargarActivo = async (a: ActivoResponse) => {
        if (!boveda) return;
        setBusyActivoId(a.id);
        let dek: Uint8Array | null = null;
        try {
            const dl = await activosService.descarga(bid, a.id, verifier);
            const der = await deriveFromEnvelope(passphrase, boveda.kdf); // DEK solo para este archivo
            dek = der.dek;
            const ct = await activosService.getBlob(dl.sas_url);
            const blob = await decryptToBlob(dek, dl.iv_hex, ct, dl.mime);
            // usa el nombre numerado (share_231 (1).sss) si es un duplicado,
            // para que el archivo descargado se distinga del que ya tienes.
            saveBlob(displayNombreById.get(a.id) ?? dl.nombre_original, blob);
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo descargar/descifrar el activo.'));
        } finally {
            wipe(dek);
            setBusyActivoId(null);
        }
    };

    // Descifra un activo de plantilla EN MEMORIA (no lo descarga) y abre la vista.
    const verCredencial = async (a: ActivoResponse) => {
        if (!boveda) return;
        setBusyActivoId(a.id);
        let dek: Uint8Array | null = null;
        try {
            const dl = await activosService.descarga(bid, a.id, verifier);
            const der = await deriveFromEnvelope(passphrase, boveda.kdf);
            dek = der.dek;
            const ct = await activosService.getBlob(dl.sas_url);
            const blob = await decryptToBlob(dek, dl.iv_hex, ct, dl.mime);
            setViewer({ activo: a, envelope: parseEnvelope(await blob.text()) });
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo abrir la plantilla.'));
        } finally {
            wipe(dek);
            setBusyActivoId(null);
        }
    };

    const recargarActivos = async () => {
        setActivos(await activosService.list(bid));
        setBoveda(await bovedasService.get(bid)); // refresca uso de espacio
    };

    const eliminarActivo = async (a: ActivoResponse) => {
        setBusyActivoId(a.id);
        try {
            await activosService.remove(bid, a.id, verifier);
            setActivos((prev) => prev.filter((x) => x.id !== a.id));
            setBoveda(await bovedasService.get(bid)); // refresca uso de espacio
            notifySuccess('Activo eliminado.');
        } catch (e) {
            notifyError(getApiErrorMessage(e, 'No se pudo eliminar el activo.'));
        } finally {
            setBusyActivoId(null);
            setToDeleteActivo(null);
        }
    };

    if (!boveda) {
        return (
            <DashboardLayout activeItem="bovedas" topBarLabel="Gestionar Bóveda" backTo="/bovedas">
                {loadFailed ? null : <p className="text-muted">Cargando…</p>}
            </DashboardLayout>
        );
    }

    const badge = bovedaBadge(boveda);

    return (
        <DashboardLayout activeItem="bovedas" topBarLabel="Gestionar Bóveda" backTo="/bovedas">
            <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
                <div>
                    <h2 className="fw-bold mb-1">{boveda.nombre}</h2>
                    <p className="text-muted m-0">
                        {boveda.categoria || 'Sin categoría'} · estado <strong>{boveda.estado}</strong> ·{' '}
                        <span className={`badge-estado ${badge}`}>{badge.toUpperCase()}</span> · PID{' '}
                        <code>{boveda.pid}</code>
                    </p>
                </div>
                <span className="k-n-badge">{k || '–'} / {n || '–'}</span>
            </div>

            {!unlocked ? (
                <div className="config-card" style={{ maxWidth: 560 }}>
                    <h4 className="fw-bold mb-1">Confirmar llave maestra</h4>
                    <p className="text-muted small">
                        Toda operación sobre la bóveda (salvo borrarla) exige su pass-phrase. Se deriva aquí y solo
                        se envía el verificador.
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
            ) : (
                <div className="row g-4">
                    {/* metadatos */}
                    <div className="col-12">
                        <div className="config-card">
                            <h5 className="fw-bold mb-3">Metadatos</h5>
                            <div className="row g-3">
                                <div className="col-md-5">
                                    <label className="form-label-b d-block">Nombre</label>
                                    <input className="form-control shadow-none" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                                </div>
                                <div className="col-md-7">
                                    <label className="form-label-b d-block">Mensaje para custodios</label>
                                    <textarea className="form-control shadow-none" rows={2} value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
                                </div>
                            </div>
                            <button className="btn btn-ipn mt-3" onClick={saveMeta} disabled={saving}>
                                {saving ? 'Guardando…' : 'Guardar cambios'}
                            </button>
                        </div>
                    </div>

                    {/* re-vinculación */}
                    <div className="col-12">
                        <div className="config-card">
                            <h5 className="fw-bold mb-1">Custodios vinculados</h5>
                            <p className="text-muted small mb-1">
                                Haz clic en un custodio para seleccionarlo; haz clic otra vez para quitarlo.
                            </p>
                            <p className="text-muted small mb-3">
                                Fragmento {asignacion.length} de {n} seleccionados.
                            </p>
                            <div className="row g-3 mb-3">
                                {directorio.map((c) => {
                                    const x = xDe(c.id);
                                    const isSel = x !== undefined;
                                    const notificable = custodioNotificable(c);
                                    return (
                                        <div className="col-md-4" key={c.id}>
                                            <div
                                                className={`custodian-selector-card ${isSel ? 'selected' : ''} ${notificable ? '' : 'is-disabled'}`}
                                                onClick={() => toggle(c.id)}
                                                title={notificable ? '' : 'Sin canal verificado'}
                                            >
                                                <div className="d-flex align-items-center gap-2">
                                                    <div className="custodian-avatar">{c.nombre.slice(0, 2).toUpperCase()}</div>
                                                    <div className="flex-grow-1">
                                                        <p className="m-0 fw-bold small">{c.nombre}</p>
                                                        <p className="m-0 text-muted" style={{ fontSize: '0.65rem' }}>{c.correo}</p>
                                                    </div>
                                                    {isSel && <span className="x-chip">x={x}</span>}
                                                    {!notificable && <span className="no-verif-chip">sin verificar</span>}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {cambios.length > 0 && (
                                <div className="logic-hint mb-3">
                                    <i className="fas fa-triangle-exclamation me-2" />
                                    Cambios por guardar:
                                    <ul className="mb-0 mt-1 small">
                                        {cambios.map((cb) => (
                                            <li key={`${cb.tipo}-${cb.id_custodio}`}>
                                                <strong>{nombreDe(cb.id_custodio)}</strong>{' '}
                                                {cb.tipo === 'nuevo' && <>se vincula con x={cb.nueva}</>}
                                                {cb.tipo === 'cambio' && <>pasa de x={cb.anterior} a x={cb.nueva}</>}
                                                {cb.tipo === 'baja' && <>se desvincula (tenía x={cb.anterior})</>}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <button
                                className="btn btn-ipn"
                                onClick={onClickGuardarVinculacion}
                                disabled={linking || asignacion.length !== n || cambios.length === 0}
                            >
                                {linking ? 'Guardando…' : 'Guardar vinculación'}
                            </button>
                        </div>
                    </div>

                    {/* activos digitales */}
                    <div className="col-12">
                        <div className="config-card">
                            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                                <h5 className="fw-bold m-0">Activos digitales</h5>
                                <div className="d-flex gap-2">
                                    <button
                                        className="btn btn-sm btn-ipn"
                                        onClick={() => setEditor({ modo: 'crear' })}
                                    >
                                        <i className="fas fa-list-check me-1" /> Nueva plantilla
                                    </button>
                                    <button
                                        className="btn btn-sm btn-ipn"
                                        onClick={() => navigate(`/bovedas/${bid}/activos/nuevo`)}
                                    >
                                        <i className="fas fa-plus me-1" /> Subir archivos
                                    </button>
                                </div>
                            </div>

                            <div className="storage-card mb-3">
                                <StorageMeter usado={boveda.usado_bytes} cuota={boveda.cuota_bytes} />
                            </div>

                            {activos.length > ASSETS_PER_PAGE && (
                                <div className="mb-3">
                                    <div className="input-group input-group-sm">
                                        <span className="input-group-text bg-white border-end-0">
                                            <i className="fas fa-search text-muted" />
                                        </span>
                                        <input
                                            type="text"
                                            className="form-control border-start-0 shadow-none"
                                            placeholder="Buscar por nombre de archivo…"
                                            value={assetSearch}
                                            onChange={(e) => {
                                                setAssetSearch(e.target.value);
                                                setAssetPage(1);
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {activos.length === 0 ? (
                                <p className="text-muted small m-0">Esta bóveda aún no tiene activos.</p>
                            ) : filteredActivos.length === 0 ? (
                                <p className="text-muted small m-0">
                                    Sin resultados para «{assetSearch}».
                                </p>
                            ) : (
                                <>
                                    {pagedActivos.map((a) => {
                                    const tpl = plantillaById(a.plantilla);
                                    const ext = extensionOf(a.nombre_original);
                                    const nombreMostrado = displayNombreById.get(a.id) ?? a.nombre_original;
                                    return (
                                    <div className="asset-row" key={a.id}>
                                        <div className="file-icon">
                                            <i className={`fas ${tpl ? tpl.icon : 'fa-file-shield'}`} />
                                        </div>
                                        <div className="flex-grow-1">
                                            <p className="m-0 fw-bold small d-flex align-items-center gap-2">
                                                {nombreMostrado}
                                                {ext && <span className="asset-ext-badge">{ext}</span>}
                                            </p>
                                            <p className="m-0 text-muted" style={{ fontSize: '0.65rem' }}>
                                                {tpl
                                                    ? `Plantilla · ${tpl.label}`
                                                    : `${humanBytes(a.tamano_bytes)} · AES-256-GCM`}
                                                {a.created_at && ` · ${formatFechaActivo(a.created_at)}`}
                                            </p>
                                        </div>
                                        {tpl ? (
                                            <button
                                                className="btn btn-sm btn-outline-primary rounded-pill me-1"
                                                onClick={() => verCredencial(a)}
                                                disabled={busyActivoId === a.id}
                                            >
                                                {busyActivoId === a.id ? '…' : <><i className="fas fa-eye me-1" />Ver</>}
                                            </button>
                                        ) : (
                                            <button
                                                className="btn btn-sm btn-outline-primary rounded-pill me-1"
                                                onClick={() => descargarActivo(a)}
                                                disabled={busyActivoId === a.id}
                                            >
                                                {busyActivoId === a.id ? '…' : <><i className="fas fa-download me-1" />Descargar</>}
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-sm btn-outline-danger rounded-pill"
                                            onClick={() => setToDeleteActivo(a)}
                                            disabled={busyActivoId === a.id}
                                            title="Eliminar"
                                        >
                                            <i className="fas fa-trash" />
                                        </button>
                                    </div>
                                    );
                                    })}

                                    {totalAssetPages > 1 && (
                                        <div className="d-flex justify-content-between align-items-center mt-3">
                                            <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                                                Página {currentAssetPage} de {totalAssetPages} · {filteredActivos.length} archivo(s)
                                            </span>
                                            <div className="d-flex gap-2">
                                                <button
                                                    className="btn btn-sm btn-light rounded-pill"
                                                    disabled={currentAssetPage <= 1}
                                                    onClick={() => setAssetPage((p) => Math.max(1, p - 1))}
                                                >
                                                    <i className="fas fa-chevron-left" />
                                                </button>
                                                <button
                                                    className="btn btn-sm btn-light rounded-pill"
                                                    disabled={currentAssetPage >= totalAssetPages}
                                                    onClick={() => setAssetPage((p) => Math.min(totalAssetPages, p + 1))}
                                                >
                                                    <i className="fas fa-chevron-right" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="mt-4">
                <button className="btn btn-light rounded-pill" onClick={() => navigate('/bovedas')}>
                    <i className="fas fa-arrow-left me-2" /> Volver
                </button>
            </div>

            {toDeleteActivo && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" style={{ background: 'var(--danger-red)' }} />
                            <div className="modal-body p-5 text-center">
                                <div className="mb-3 text-danger">
                                    <i className="fas fa-trash-alt fa-3x" />
                                </div>
                                <h4 className="fw-bold">Eliminar activo</h4>
                                <p className="text-muted small">
                                    Vas a eliminar <strong>{displayNombreById.get(toDeleteActivo.id) ?? toDeleteActivo.nombre_original}</strong> de forma
                                    permanente. Esta acción no se puede deshacer.
                                </p>
                                <div className="d-flex gap-3 mt-4">
                                    <button
                                        className="btn btn-light w-100 rounded-pill"
                                        onClick={() => setToDeleteActivo(null)}
                                        disabled={busyActivoId === toDeleteActivo.id}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        className="btn w-100 rounded-pill text-white"
                                        style={{ background: 'var(--danger-red)' }}
                                        onClick={() => eliminarActivo(toDeleteActivo)}
                                        disabled={busyActivoId === toDeleteActivo.id}
                                    >
                                        {busyActivoId === toDeleteActivo.id ? 'Eliminando…' : 'Eliminar permanentemente'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {renombrarAbierto && (
                <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog modal-dialog-centered modal-lg">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient" />
                            <div className="modal-body p-5">
                                <h4 className="fw-bold mb-1">Verificar fragmentos antes de guardar</h4>
                                <p className="text-muted small mb-4">
                                    Sube el archivo <code>.sss</code> que ya tienes para cada custodio nuevo o
                                    reasignado. Se valida contra los compromisos de esta bóveda y, si es correcto,
                                    se descarga de inmediato ya renombrado con el custodio correcto.
                                </p>
                                {pendientesRenombrar.map((item) => {
                                    const estado = subidas[item.id_custodio] ?? 'pendiente';
                                    return (
                                        <div
                                            key={item.id_custodio}
                                            className="d-flex align-items-center gap-3 p-3 mb-2 border rounded-4"
                                        >
                                            <div className="flex-grow-1">
                                                <p className="m-0 fw-bold small">{nombreDe(item.id_custodio)}</p>
                                                <p className="m-0 text-muted" style={{ fontSize: '0.7rem' }}>
                                                    Fragmento x={item.nueva}
                                                </p>
                                                {estado === 'error' && (
                                                    <p className="m-0 small" style={{ color: 'var(--danger-red)' }}>
                                                        <i className="fas fa-circle-xmark me-1" />
                                                        Ese archivo no es el fragmento x={item.nueva} de esta bóveda.
                                                    </p>
                                                )}
                                            </div>
                                            {estado === 'ok' ? (
                                                <span className="small fw-bold" style={{ color: 'var(--escom-blue)' }}>
                                                    <i className="fas fa-circle-check me-1" /> Verificado
                                                </span>
                                            ) : (
                                                <input
                                                    type="file"
                                                    accept=".sss,text/plain"
                                                    className="form-control form-control-sm"
                                                    style={{ maxWidth: 260 }}
                                                    disabled={estado === 'verificando'}
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) subirFragmentoRenombrado(item, file);
                                                    }}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                                <div className="d-flex gap-3 mt-4">
                                    <button
                                        className="btn btn-light w-100 rounded-pill"
                                        onClick={cerrarModalRenombrar}
                                        disabled={linking}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        className="btn btn-ipn w-100"
                                        disabled={
                                            linking ||
                                            !pendientesRenombrar.every((p) => subidas[p.id_custodio] === 'ok')
                                        }
                                        onClick={confirmarRenombradoYGuardar}
                                    >
                                        {linking ? 'Guardando…' : 'Confirmar y guardar vinculación'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {editor && unlocked && (
                <CredentialEditorModal
                    boveda={boveda}
                    verifier={verifier}
                    passphrase={passphrase}
                    modo={editor.modo}
                    activo={editor.modo === 'editar' ? editor.activo : undefined}
                    nombreVisible={editor.modo === 'editar' ? displayNombreById.get(editor.activo.id) : undefined}
                    envelopeInicial={editor.modo === 'editar' ? editor.envelope : undefined}
                    activosExistentes={activos}
                    onClose={() => setEditor(null)}
                    onSaved={async () => {
                        setEditor(null);
                        notifySuccess(editor.modo === 'editar' ? 'Plantilla actualizada.' : 'Plantilla agregada.');
                        await recargarActivos();
                    }}
                />
            )}

            {viewer && (
                <CredentialViewModal
                    envelope={viewer.envelope}
                    nombreActivo={displayNombreById.get(viewer.activo.id) ?? viewer.activo.nombre_original}
                    bovedaNombre={boveda.nombre}
                    onEditar={() => {
                        setEditor({ modo: 'editar', activo: viewer.activo, envelope: viewer.envelope });
                        setViewer(null);
                    }}
                    onClose={() => setViewer(null)}
                />
            )}
        </DashboardLayout>
    );
}