// src/credentials/CredentialForm.tsx
//
// Formulario dinámico a partir de una Plantilla. Controlado: el padre es
// dueño del diccionario de campos y lo usa para construir el envelope.

import { useState } from 'react';
import type { Plantilla, CampoPlantilla } from './templates';

interface Props {
    plantilla: Plantilla;
    value: Record<string, string>;
    onChange: (next: Record<string, string>) => void;
}

export default function CredentialForm({ plantilla, value, onChange }: Props) {
    const [revelados, setRevelados] = useState<Record<string, boolean>>({});

    const set = (key: string, v: string) => onChange({ ...value, [key]: v });
    const toggle = (key: string) => setRevelados((r) => ({ ...r, [key]: !r[key] }));

    const renderCampo = (c: CampoPlantilla) => {
        const v = value[c.key] ?? '';

        if (c.tipo === 'textarea') {
            return (
                <textarea
                    className="form-control shadow-none"
                    rows={c.key === 'cuerpo' ? 8 : 3}
                    value={v}
                    onChange={(e) => set(c.key, e.target.value)}
                />
            );
        }

        if (c.tipo === 'password') {
            return (
                <div className="input-group">
                    <input
                        type={revelados[c.key] ? 'text' : 'password'}
                        className="form-control shadow-none"
                        autoComplete="off"
                        value={v}
                        onChange={(e) => set(c.key, e.target.value)}
                    />
                    <button
                        type="button"
                        className="btn btn-outline-secondary"
                        tabIndex={-1}
                        onClick={() => toggle(c.key)}
                        aria-label={revelados[c.key] ? 'Ocultar' : 'Mostrar'}
                    >
                        <i className={`fas ${revelados[c.key] ? 'fa-eye-slash' : 'fa-eye'}`} />
                    </button>
                </div>
            );
        }

        return (
            <input
                type={c.tipo === 'number' ? 'number' : c.tipo === 'url' ? 'url' : c.tipo === 'date' ? 'date' : 'text'}
                className="form-control shadow-none"
                autoComplete="off"
                value={v}
                onChange={(e) => set(c.key, e.target.value)}
            />
        );
    };

    return (
        <div className="row g-3">
            {plantilla.campos.map((c) => (
                <div className={c.tipo === 'textarea' ? 'col-12' : 'col-md-6'} key={c.key}>
                    <label className="form-label-b d-block">{c.label}</label>
                    {renderCampo(c)}
                    {c.help && <p className="text-muted m-0 mt-1" style={{ fontSize: '0.7rem' }}>{c.help}</p>}
                </div>
            ))}
        </div>
    );
}
