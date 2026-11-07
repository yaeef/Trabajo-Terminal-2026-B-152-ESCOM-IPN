import { useState } from 'react';

interface Props {
    title: string;
    description?: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: (motivo: string) => Promise<void> | void;
    onClose: () => void;
}

/**
 * Modal genérico para las acciones admin que solo piden justificar un
 * motivo (queda en la auditoría — ver services/admin/auditoria.py). Mismo
 * markup `.modal.fade.show.d-block` que ya usa Custodios.tsx.
 */
export default function AdminMotivoModal({ title, description, confirmLabel = 'Confirmar', danger, onConfirm, onClose }: Props) {
    const [motivo, setMotivo] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        if (motivo.trim().length < 5) {
            setError('Escribe un motivo de al menos 5 caracteres.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            await onConfirm(motivo.trim());
        } catch {
            // El llamador ya muestra su propio error si falla; este modal solo evita cerrarse.
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content shadow-lg">
                    <div className="modal-header-gradient" style={danger ? { background: 'var(--danger-red)' } : undefined} />
                    <div className="modal-body p-5">
                        <h4 className="fw-bold mb-1">{title}</h4>
                        {description && <p className="text-muted small mb-4">{description}</p>}
                        {error && <div className="alert alert-danger py-2 small">{error}</div>}
                        <label className="form-label-b d-block">Motivo (queda en la auditoría)</label>
                        <textarea
                            className="form-control shadow-none mb-4"
                            rows={3}
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            placeholder="Ej: el custodio reportó por soporte no haber recibido el correo."
                        />
                        <div className="d-flex gap-3">
                            <button className="btn btn-light w-100 rounded-pill" onClick={onClose} disabled={saving}>
                                Cancelar
                            </button>
                            <button
                                className={danger ? 'btn w-100 rounded-pill text-white' : 'btn btn-ipn w-100'}
                                style={danger ? { background: 'var(--danger-red)' } : undefined}
                                onClick={submit}
                                disabled={saving}
                            >
                                {saving ? 'Enviando…' : confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
