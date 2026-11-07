// src/credentials/CredentialViewModal.tsx
//
// Vista de solo lectura de un activo de plantilla ya descifrado en memoria.
// Los campos sensibles salen enmascarados con un botón de revelar. Desde
// aquí se abre la hoja imprimible (→ PDF).

import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
    campoEsSecreto,
    plantillaById,
    CRED_SUFFIX,
    type CredentialEnvelope,
} from './templates';
import { openCredentialSheet } from './credentialSheet';
import { saveBlob } from '../crypto/assetCrypto';
import { useNotice } from '../store/NoticeContext';

interface Props {
    envelope: CredentialEnvelope;
    nombreActivo: string;
    bovedaNombre: string;
    onEditar?: () => void;
    onClose: () => void;
}

export default function CredentialViewModal({
    envelope,
    nombreActivo,
    bovedaNombre,
    onEditar,
    onClose,
}: Props) {
    const [revelados, setRevelados] = useState<Record<string, boolean>>({});
    const { notifyWarning } = useNotice();
    const plantilla = plantillaById(envelope.b152_plantilla);

    const orden = plantilla?.campos ?? [];
    const conocidos = new Set(orden.map((c) => c.key));
    const filas = [
        ...orden
            .filter((c) => (envelope.campos[c.key] ?? '').trim())
            .map((c) => ({ key: c.key, label: c.label, valor: envelope.campos[c.key], secreto: campoEsSecreto(c) })),
        ...Object.entries(envelope.campos)
            .filter(([k, v]) => !conocidos.has(k) && (v ?? '').trim())
            .map(([k, v]) => ({ key: k, label: k, valor: v, secreto: true })),
    ];

    const toggle = (k: string) => setRevelados((r) => ({ ...r, [k]: !r[k] }));

    return createPortal(
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.55)' }}>
            <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable modal-lg">
                <div className="modal-content shadow-lg">
                    <div className="modal-header">
                        <div>
                            <h5 className="modal-title fw-bold m-0">{plantilla?.label ?? 'Credenciales'}</h5>
                            <p className="text-muted m-0 small">{nombreActivo}</p>
                        </div>
                        <button type="button" className="btn-close" onClick={onClose} aria-label="Cerrar" />
                    </div>

                    <div className="modal-body">
                        <div className="alert alert-warning py-2 small">
                            <i className="fas fa-triangle-exclamation me-1" />
                            Contenido descifrado en tu navegador. No lo dejes visible en pantallas compartidas.
                        </div>

                        {filas.length === 0 ? (
                            <p className="text-muted small m-0">Este activo no tiene campos con valor.</p>
                        ) : (
                            filas.map((f) => (
                                <div className="mb-3" key={f.key}>
                                    <label className="form-label-b d-block">{f.label}</label>
                                    <div className="d-flex align-items-start gap-2">
                                        <div
                                            className="flex-grow-1"
                                            style={{
                                                whiteSpace: 'pre-wrap',
                                                wordBreak: 'break-word',
                                                fontFamily: f.secreto ? 'ui-monospace, Menlo, monospace' : undefined,
                                                background: f.secreto ? 'var(--bs-tertiary-bg, #f1f5f9)' : undefined,
                                                border: f.secreto ? '1px dashed #cbd5e1' : undefined,
                                                borderRadius: 8,
                                                padding: f.secreto ? '8px 10px' : 0,
                                            }}
                                        >
                                            {f.secreto && !revelados[f.key] ? '••••••••••' : f.valor}
                                        </div>
                                        {f.secreto && (
                                            <button
                                                className="btn btn-sm btn-outline-secondary"
                                                onClick={() => toggle(f.key)}
                                            >
                                                <i className={`fas ${revelados[f.key] ? 'fa-eye-slash' : 'fa-eye'}`} />
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-sm btn-outline-secondary"
                                            title="Copiar"
                                            onClick={() => navigator.clipboard?.writeText(f.valor)}
                                        >
                                            <i className="fas fa-copy" />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="modal-footer">
                        {onEditar && (
                            <button className="btn btn-outline-primary rounded-pill" onClick={onEditar}>
                                <i className="fas fa-pen me-1" /> Editar
                            </button>
                        )}
                        <button
                            className="btn btn-outline-secondary rounded-pill"
                            onClick={() => {
                                const blob = new Blob([JSON.stringify(envelope, null, 2)], {
                                    type: 'application/json',
                                });
                                saveBlob(`${nombreActivo}${CRED_SUFFIX}`, blob);
                            }}
                        >
                            <i className="fas fa-file-code me-1" /> Descargar JSON
                        </button>
                        <button
                            className="btn btn-ipn rounded-pill"
                            onClick={() => {
                                const ok = openCredentialSheet({ envelope, nombreActivo, bovedaNombre });
                                if (!ok) notifyWarning('El navegador bloqueó la pestaña. Permite las ventanas emergentes e inténtalo de nuevo.');
                            }}
                        >
                            <i className="fas fa-file-pdf me-1" /> Descargar PDF
                        </button>
                        <button className="btn btn-light rounded-pill" onClick={onClose}>Cerrar</button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
