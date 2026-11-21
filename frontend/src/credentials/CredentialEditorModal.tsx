// src/credentials/CredentialEditorModal.tsx
//
// Alta / edición de un activo de plantilla. Vive dentro de GestionarBoveda,
// que ya tiene la bóveda desbloqueada (passphrase + verifier en memoria).
//
// El JSON canónico se cifra aquí con la DEK (AES-256-GCM) y se sube con el
// MISMO flujo iniciar → PUT blob → confirmar que un archivo normal. En
// edición se sube el nuevo y, sólo si todo salió bien, se borra el viejo.

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BovedaResponse } from '../types/bovedas.types';
import type { ActivoResponse } from '../types/activos.types';
import { activosService } from '../services/activos.service';
import { deriveFromEnvelope } from '../crypto/vaultCrypto';
import { wipe } from '../crypto/sensitiveMemory';
import { encryptFile } from '../crypto/assetCrypto';
import { withMinDelay } from '../utils/progress';
import { getApiErrorMessage } from '../utils/errors';
import CredentialForm from './CredentialForm';
import { t, useLang } from '../i18n';
import {
    CRED_MIME,
    construirEnvelope,
    nombrePorDefecto,
    plantillaById,
    plantillas,
    type CredentialEnvelope,
} from './templates';

interface Props {
    boveda: BovedaResponse;
    verifier: string;
    passphrase: string;
    modo: 'crear' | 'editar';
    activo?: ActivoResponse;              // requerido en 'editar'
    nombreVisible?: string;               // nombre numerado ("archivo (1).ext") si es un duplicado
    envelopeInicial?: CredentialEnvelope; // requerido en 'editar'
    activosExistentes?: ActivoResponse[]; // para detectar nombres duplicados
    onClose: () => void;
    onSaved: () => void;
}

export default function CredentialEditorModal({
    boveda,
    verifier,
    passphrase,
    modo,
    activo,
    envelopeInicial,
    nombreVisible,
    activosExistentes = [],
    onClose,
    onSaved,
}: Props) {
    const [plantillaId, setPlantillaId] = useState<string | null>(
        modo === 'editar' ? envelopeInicial?.b152_plantilla ?? activo?.plantilla ?? null : null,
    );
    // lang en las dependencias: las etiquetas de la plantilla cambian con el idioma.
    const lang = useLang();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const plantilla = useMemo(() => plantillaById(plantillaId), [plantillaId, lang]);

    const [campos, setCampos] = useState<Record<string, string>>(
        () => ({ ...(envelopeInicial?.campos ?? {}) }),
    );
    const [nombre, setNombre] = useState(nombreVisible ?? activo?.nombre_original ?? '');
    const [nombreTocado, setNombreTocado] = useState(modo === 'editar');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    // progreso de cifrado/subida (mismo patrón que "Agregar activos")
    const [running, setRunning] = useState(false);
    // cifrando: la fase de cifrado local (ícono de candado) frente a las de red.
    const [prog, setProg] = useState({ pct: 0, text: '', done: false, cifrando: false });

    // nombre duplicado detectado, pendiente de confirmación del usuario
    const [dupPendiente, setDupPendiente] = useState<string | null>(null);

    // nombre sugerido a partir del campo "identidad" mientras el usuario no lo edite
    const nombreEfectivo = useMemo(() => {
        if (nombreTocado) return nombre;
        return plantilla ? nombrePorDefecto(plantilla, campos) : '';
    }, [nombreTocado, nombre, plantilla, campos]);

    const elegir = (id: string) => {
        setPlantillaId(id);
        setCampos({});
        setNombreTocado(false);
    };

    const ejecutarGuardado = async (nombreFinal: string) => {
        if (!plantilla) return;
        setBusy(true);
        setRunning(true);
        setErr('');
        setProg({ pct: 5, text: t('Cifrando datos localmente…', 'Encrypting data locally…'), done: false, cifrando: true });
        let dek: Uint8Array | null = null;
        try {
            const envelope = construirEnvelope(plantilla.id, campos, envelopeInicial);
            const json = JSON.stringify(envelope, null, 2);
            const file = new File([json], nombreFinal, { type: CRED_MIME });

            const der = await deriveFromEnvelope(passphrase, boveda.kdf);
            dek = der.dek;
            const enc = await withMinDelay(encryptFile(dek, file));

            setProg({ pct: 35, text: t('Reservando espacio…', 'Reserving space…'), done: false, cifrando: false });
            const ini = await withMinDelay(
                activosService.iniciar(boveda.id, {
                    passphrase_verifier: verifier,
                    nombre: nombreFinal,
                    mime: CRED_MIME,
                    plantilla: plantilla.id,
                    tamano_bytes: enc.tamanoBytes,
                    tamano_cifrado: enc.tamanoCifrado,
                    iv_hex: enc.ivHex,
                    sha256_plano: enc.sha256Hex,
                }),
            );

            setProg({ pct: 65, text: t('Subiendo…', 'Uploading…'), done: false, cifrando: false });
            await withMinDelay(activosService.putBlob(ini.sas_url, enc.ciphertext));

            setProg({ pct: 85, text: t('Confirmando…', 'Confirming…'), done: false, cifrando: false });
            await withMinDelay(activosService.confirmar(boveda.id, ini.activo_id, verifier));

            // el nuevo ya está confirmado: recién ahora se borra el anterior
            if (modo === 'editar' && activo) {
                setProg({ pct: 95, text: t('Eliminando versión anterior…', 'Deleting previous version…'), done: false, cifrando: false });
                await withMinDelay(activosService.remove(boveda.id, activo.id, verifier));
            }
            wipe(dek);
            setProg({ pct: 100, text: t('Plantilla guardada.', 'Template saved.'), done: true, cifrando: false });
            setTimeout(() => onSaved(), 900);
        } catch (e) {
            wipe(dek);
            setRunning(false);
            setErr(getApiErrorMessage(e, t('No se pudo guardar la plantilla.', "Couldn't save the template.")));
        } finally {
            setBusy(false);
        }
    };

    const guardar = async () => {
        if (!plantilla) return;
        const nombreFinal = (nombreEfectivo || plantilla.label).trim().slice(0, 255);
        if (!Object.values(campos).some((v) => (v ?? '').trim())) {
            setErr(t('Llena al menos un campo antes de guardar.', 'Fill in at least one field before saving.'));
            return;
        }
        const duplicado = activosExistentes.some(
            (a) => a.id !== activo?.id && a.nombre_original.toLowerCase() === nombreFinal.toLowerCase(),
        );
        if (duplicado) {
            setDupPendiente(nombreFinal);
            return;
        }
        await ejecutarGuardado(nombreFinal);
    };

    return createPortal(
        <>
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
            <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
                <div className="modal-content shadow-lg">
                    <div className="modal-header">
                        <h5 className="modal-title fw-bold m-0">
                            {modo === 'editar' ? t('Editar plantilla', 'Edit template') : t('Nueva plantilla de credenciales', 'New credential template')}
                        </h5>
                        <button type="button" className="btn-close" onClick={onClose} disabled={busy} aria-label={t('Cerrar', 'Close')} />
                    </div>

                    <div className="modal-body">
                        {err && <div className="alert alert-danger py-2 small">{err}</div>}

                        {!plantilla ? (
                            <>
                                <p className="text-muted small">
                                    {t('Elige una plantilla. Los campos se cifran en tu navegador y se guardan como un activo más de la bóveda.', 'Choose a template. The fields are encrypted in your browser and saved as another asset in the vault.')}
                                </p>
                                <div className="row g-2">
                                    {plantillas().map((p) => (
                                        <div className="col-md-6" key={p.id}>
                                            <button
                                                type="button"
                                                className="btn btn-outline-secondary w-100 text-start p-3 h-100"
                                                onClick={() => elegir(p.id)}
                                            >
                                                <div className="fw-bold">
                                                    <i className={`fas ${p.icon} me-2`} />
                                                    {p.label}
                                                </div>
                                                <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                                                    {p.descripcion}
                                                </div>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="d-flex align-items-center justify-content-between mb-3">
                                    <span className="fw-bold">
                                        <i className={`fas ${plantilla.icon} me-2`} />
                                        {plantilla.label}
                                    </span>
                                    {modo === 'crear' && (
                                        <button
                                            className="btn btn-sm btn-link text-muted p-0"
                                            onClick={() => setPlantillaId(null)}
                                            disabled={busy}
                                        >
                                            {t('Cambiar plantilla', 'Change template')}
                                        </button>
                                    )}
                                </div>

                                <div className="mb-3">
                                    <label className="form-label-b d-block">{t('Nombre del activo', 'Asset name')}</label>
                                    <input
                                        className="form-control shadow-none"
                                        value={nombreEfectivo}
                                        onChange={(e) => { setNombre(e.target.value); setNombreTocado(true); }}
                                        placeholder={plantilla.label}
                                    />
                                </div>

                                <CredentialForm plantilla={plantilla} value={campos} onChange={setCampos} />

                                <div className="alert alert-warning py-2 small mt-3 mb-0">
                                    <i className="fas fa-shield-halved me-1" />
                                    {t('Se protege antes de guardarse: Kleimos nunca ve estos datos.', 'Protected before it is saved: Kleimos never sees this data.')}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="modal-footer">
                        <button className="btn btn-light rounded-pill" onClick={onClose} disabled={busy}>
                            {t('Cancelar', 'Cancel')}
                        </button>
                        {plantilla && (
                            <button className="btn btn-ipn rounded-pill px-4" onClick={guardar} disabled={busy}>
                                {busy ? t('Guardando…', 'Saving…') : (
                                    <><i className="fas fa-lock me-1" /> {t('Cifrar y guardar', 'Encrypt and save')}</>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {dupPendiente && (
            <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.65)' }}>
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content shadow-lg">
                        <div className="modal-header-gradient" style={{ background: 'var(--warning-amber)' }} />
                        <div className="modal-body p-5 text-center">
                            <div className="mb-3" style={{ color: 'var(--warning-amber)' }}>
                                <i className="fas fa-triangle-exclamation fa-3x animate__animated animate__headShake" />
                            </div>
                            <h4 className="fw-bold">{t('Nombre duplicado', 'Duplicate name')}</h4>
                            <p className="text-muted small mb-1">
                                {t('Ya existe un activo con este nombre en la bóveda:', 'An asset with this name already exists in the vault:')}
                            </p>
                            <p className="fw-bold mb-3">{dupPendiente}</p>
                            <p className="text-muted small">{t('¿Qué quieres hacer antes de continuar?', 'What do you want to do before continuing?')}</p>
                            <div className="d-flex flex-column gap-2 mt-3">
                                <button
                                    className="btn w-100 rounded-pill text-white"
                                    style={{ background: 'var(--warning-amber)' }}
                                    onClick={() => {
                                        const n = dupPendiente;
                                        setDupPendiente(null);
                                        if (n) ejecutarGuardado(n);
                                    }}
                                >
                                    {t('Guardar de todos modos (como copia)', 'Save anyway (as a copy)')}
                                </button>
                                <button className="btn btn-light w-100 rounded-pill" onClick={() => setDupPendiente(null)}>
                                    {t('Cancelar y cambiar el nombre', 'Cancel and change the name')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {running && (
            <div className="modal fade show d-block wizard-modal" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
                <div className="modal-dialog modal-dialog-centered">
                    <div className="modal-content shadow-lg">
                        <div className="modal-header-gradient" style={prog.done ? { background: 'var(--escom-blue)' } : undefined} />
                        <div className="modal-body p-5 text-center">
                            <div className="mb-3">
                                {prog.done ? (
                                    <i className="fas fa-check-circle fa-3x animate__animated animate__bounceIn" style={{ color: 'var(--escom-blue)' }} />
                                ) : prog.cifrando ? (
                                    <i className="fas fa-lock fa-beat fa-3x" style={{ color: 'var(--ipn-maroon)' }} />
                                ) : (
                                    <i className="fas fa-sync fa-spin fa-3x text-primary" />
                                )}
                            </div>
                            <h4 className="fw-bold">
                                {prog.done
                                    ? t('Plantilla guardada', 'Template saved')
                                    : prog.cifrando
                                      ? t('Protegiendo la plantilla', 'Protecting the template')
                                      : t('Guardando plantilla', 'Saving template')}
                            </h4>
                            <p className="text-muted small">{prog.text}</p>
                            <div className="wizard-progress mt-3">
                                <div className="wizard-progress-bar" style={{ width: `${prog.pct}%` }} />
                            </div>
                            {!prog.done && (
                                <p className="text-muted mt-3 mb-0" style={{ fontSize: '0.72rem' }}>
                                    <i className="fas fa-triangle-exclamation me-1" />
                                    {t('No cierres ni recargues esta pestaña hasta que termine.', "Don't close or reload this tab until it finishes.")}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}
        </>,
        document.body,
    );
}