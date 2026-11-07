import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import RecuperacionSesionLayout from '../../components/recuperacion/RecuperacionSesionLayout';
import DepositosTable, { type FilaDeposito } from '../../components/recuperacion/DepositosTable';
import { recuperacionService } from '../../services/recuperacion.service';
import { getApiErrorMessage } from '../../utils/errors';
import { nombreRecordado } from '../../utils/recuperacionIdentidad';
import type { BovedaRecuperacionResponse, SesionEstadoResponse } from '../../types/recuperacion.types';

const POLL_MS = 8000;

function fmtFechaHora(iso: string): string {
    return new Date(iso).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * dashboard_custodio.html — vista de solo lectura para cualquier custodio
 * que ya depositó su fragmento. No tiene la llave privada del BP, así que
 * no puede saber si los depósitos son válidos (eso solo lo sabe el BP) —
 * solo ve cuántos han llegado y cuándo, para saber si vale la pena esperar.
 */
export default function SesionCustodio() {
    const { pid = '' } = useParams();

    const [boveda, setBoveda] = useState<BovedaRecuperacionResponse | null>(null);
    const [sesion, setSesion] = useState<SesionEstadoResponse | null>(null);
    const [err, setErr] = useState('');

    useEffect(() => {
        if (!pid) return;
        recuperacionService.buscarBoveda(pid).then(setBoveda).catch(() => undefined);
    }, [pid]);

    useEffect(() => {
        if (!pid) return;
        let cancelled = false;
        const cargar = () => {
            recuperacionService
                .getSesion(pid)
                .then((s) => !cancelled && setSesion(s))
                .catch((e) => !cancelled && setErr(getApiErrorMessage(e, 'No se pudo cargar el estado de la sesión.')));
        };
        cargar();
        const t = setInterval(cargar, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(t);
        };
    }, [pid]);

    const k = boveda?.umbral_k ?? sesion?.umbral_k ?? 0;
    const n = boveda?.total_fragmentos_n ?? sesion?.total_fragmentos_n ?? 0;
    const depositados = sesion?.depositos.length ?? 0;
    const pct = k > 0 ? Math.min(Math.round((depositados / k) * 100), 100) : 0;
    const fundador = sesion?.depositos.find((d) => d.x_fragmento === sesion.x_fundador);

    const filas: FilaDeposito[] = (sesion?.depositos ?? []).map((d) => ({
        x: d.x_fragmento,
        nombre: d.nombre_declarado,
        vinculo: d.vinculo_declarado,
        depositadoEn: d.depositado_en,
    }));

    return (
        <RecuperacionSesionLayout
            pid={pid}
            bovedaNombre={boveda?.nombre}
            rol="custodio"
            activeKey="estado"
            sesion={sesion}
            nombreMostrado={nombreRecordado(pid)}
        >
            {err && <div className="alert alert-danger py-2 small">{err}</div>}

            {sesion?.reconstruido_en ? (
                <div className="alert alert-success py-2 small d-flex align-items-center gap-2">
                    <i className="fas fa-check-circle" />
                    <span>
                        Ya se accedió al patrimonio, el {fmtFechaHora(sesion.reconstruido_en)}
                        {fundador && (
                            <>
                                {' '}
                                — Beneficiario Principal autodeclarado: <strong>"{fundador.nombre_declarado}"</strong>{' '}
                                (nombre no verificado)
                            </>
                        )}
                        .
                    </span>
                </div>
            ) : (
                fundador && (
                    <div className="alert alert-info py-2 small">
                        <i className="fas fa-crown me-1" />
                        Sesión fundada por <strong>"{fundador.nombre_declarado}"</strong> como Beneficiario Principal
                        (nombre autodeclarado, no verificado) — aún no reconstruye la llave maestra.
                    </div>
                )
            )}

            <div className="stat-card mb-4">
                <h2 className="fw-bold mb-1">Estado de la recuperación</h2>
                <p className="text-muted">
                    Visualiza el progreso de recolección de fragmentos. Solo el Beneficiario Principal puede iniciar
                    el descifrado.
                </p>
                <div className="mt-4">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                        <span className="recuperacion-label">Progreso del quórum (k={k})</span>
                        <span className="fw-bold">
                            {depositados} / {k || '—'} depositados
                        </span>
                    </div>
                    <div className="progress" style={{ height: 12, borderRadius: 10, background: '#f1f5f9' }}>
                        <div
                            className="progress-bar progress-bar-striped progress-bar-animated"
                            style={{ width: `${pct}%`, background: 'var(--ipn-maroon)' }}
                        />
                    </div>
                    {n > 0 && (
                        <p className="text-muted small mt-2 mb-0">
                            El esquema completo tiene {n} fragmentos posibles; solo hace falta que el BP recolecte {k}.
                        </p>
                    )}
                </div>
            </div>

            <DepositosTable filas={filas} />
        </RecuperacionSesionLayout>
    );
}
