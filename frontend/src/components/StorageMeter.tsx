import type { ReactNode } from 'react';
import { humanBytes } from '../crypto/assetCrypto';
import './StorageMeter.css';

interface Props {
    usado: number;
    cuota: number;
    label?: string;
    /** Texto auxiliar bajo la barra. Si se omite se muestra el % de cuota en uso. */
    note?: ReactNode;
}

/**
 * Indicador de almacenamiento unificado. Lo usan Dashboard, Mis Bóvedas,
 * Gestionar Bóveda y Agregar Activos para que el estilo sea idéntico en todos.
 * El consumidor lo envuelve en la tarjeta que corresponda (`.storage-card`,
 * `.stat-card`, …); este componente solo pinta el medidor.
 */
export default function StorageMeter({ usado, cuota, label = 'Espacio utilizado', note }: Props) {
    const conCuota = cuota > 0;
    const pct = conCuota ? Math.min((usado / cuota) * 100, 100) : 0;
    const nivel = pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : 'ok';

    return (
        <div className="smeter">
            <div className="smeter-head">
                <span className="smeter-label">{label}</span>
                <span className="smeter-value">
                    {humanBytes(usado)}
                    {conCuota && <span className="smeter-quota"> / {humanBytes(cuota)}</span>}
                </span>
            </div>
            <div className="smeter-track">
                <div className={`smeter-fill lvl-${nivel}`} style={{ width: `${pct}%` }} />
            </div>
            {note !== undefined ? (
                <p className="smeter-note">{note}</p>
            ) : conCuota ? (
                <p className="smeter-note">{pct < 1 ? '<1' : Math.round(pct)}% de tu cuota en uso</p>
            ) : (
                <p className="smeter-note">Aún sin uso registrado</p>
            )}
        </div>
    );
}
