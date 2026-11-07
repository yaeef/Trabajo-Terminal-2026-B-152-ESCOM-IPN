import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import RecuperacionSesionLayout from '../../components/recuperacion/RecuperacionSesionLayout';
import DepositosTable, { type FilaDeposito } from '../../components/recuperacion/DepositosTable';
import { recuperacionService } from '../../services/recuperacion.service';
import { useRecuperacionSession } from '../../store/RecuperacionSessionContext';
import { descifrarFragmento } from '../../crypto/recuperacionCrypto';
import { verifyShare, recoverKey, type Share } from '../../crypto/sss';
import { wipe } from '../../crypto/sensitiveMemory';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import { nombreRecordado } from '../../utils/recuperacionIdentidad';
import type { BovedaRecuperacionResponse, SesionEstadoResponse } from '../../types/recuperacion.types';

const POLL_MS = 8000;

interface DepositoEvaluado extends FilaDeposito {
    share?: Share;
}

function fmtHora(iso: string): string {
    return new Date(iso).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * bp_dashboard.html — panel del Beneficiario Principal: progreso del quórum,
 * cola de fragmentos (descifrados y validados con VSS EN ESTE NAVEGADOR, no
 * por el servidor — así un depósito manipulado nunca infla el contador) y el
 * botón de reconstrucción (interpolación de Lagrange, 100% local).
 */
export default function SesionBP() {
    const { pid = '' } = useParams();
    const navigate = useNavigate();
    const { bp, setDek } = useRecuperacionSession();
    const { notifyError } = useNotice();

    const [boveda, setBoveda] = useState<BovedaRecuperacionResponse | null>(null);
    const [sesion, setSesion] = useState<SesionEstadoResponse | null>(null);
    const [depositos, setDepositos] = useState<DepositoEvaluado[]>([]);
    const [err, setErr] = useState('');
    const [reconstruyendo, setReconstruyendo] = useState(false);
    const [progresoTxt, setProgresoTxt] = useState('');

    useEffect(() => {
        if (!bp || bp.pid !== pid) {
            // Sin passphrase en memoria: vuelve a la búsqueda, donde subir de
            // nuevo el fragmento reconoce automáticamente que es el fundador
            // y solo pide la pass-phrase para reingresar.
            navigate(`/recuperacion/${pid}`, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bp, pid]);

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

    // Descifra + valida cada depósito con la llave del BP. Un depósito que no
    // descifra o no pasa VSS se marca inválido y NO cuenta para el quórum.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!sesion || !boveda?.commitments_hex || !bp) return;
            const evaluados: DepositoEvaluado[] = [];
            for (const d of sesion.depositos) {
                const base = {
                    x: d.x_fragmento,
                    nombre: d.nombre_declarado,
                    vinculo: d.vinculo_declarado,
                    depositadoEn: d.depositado_en,
                };
                try {
                    const share = await descifrarFragmento(
                        {
                            xFragmento: d.x_fragmento,
                            epkHex: d.epk_hex,
                            ivHex: d.iv_hex,
                            ciphertextHex: d.ciphertext_hex,
                        },
                        bp.privateKey,
                    );
                    const ok = await verifyShare(share, boveda.commitments_hex);
                    if (ok) {
                        evaluados.push({ ...base, estado: 'valido', share });
                    } else {
                        wipe(share.y);
                        evaluados.push({ ...base, estado: 'invalido' });
                    }
                } catch {
                    evaluados.push({ ...base, estado: 'invalido' });
                }
            }
            if (!cancelled) setDepositos(evaluados);
        })();
        return () => {
            cancelled = true;
        };
    }, [sesion, boveda, bp]);

    const k = boveda?.umbral_k ?? sesion?.umbral_k ?? 0;
    const n = boveda?.total_fragmentos_n ?? sesion?.total_fragmentos_n ?? 0;
    const validCount = depositos.filter((d) => d.estado === 'valido').length;
    const puedeReconstruir = k > 0 && validCount >= k;
    const pct = k > 0 ? Math.min(Math.round((validCount / k) * 100), 100) : 0;

    const reconstruir = async () => {
        if (!puedeReconstruir) return;
        setReconstruyendo(true);
        const shares = depositos.filter((d) => d.estado === 'valido' && d.share).map((d) => d.share!);
        try {
            setProgresoTxt('Calculando coeficientes…');
            await new Promise((r) => setTimeout(r, 500));
            setProgresoTxt('Interpolando el polinomio (Shamir)…');
            const dek = await recoverKey(shares);
            setProgresoTxt('Llave maestra reconstruida.');
            await new Promise((r) => setTimeout(r, 400));
            setDek(dek);
            // Reporte informativo para los custodios — no expone la DEK ni
            // nada sensible, solo "sí funcionó, aquí está la hora". Si falla
            // (red caída, etc.) no bloquea el acceso a los activos.
            recuperacionService.marcarReconstruido(pid).catch(() => undefined);
            navigate(`/recuperacion/${pid}/activos`);
        } catch (e) {
            notifyError(e instanceof Error ? e.message : 'No se pudo reconstruir la llave maestra.');
            shares.forEach((s) => wipe(s.y));
        } finally {
            setReconstruyendo(false);
        }
    };

    if (!bp || bp.pid !== pid) return null;

    const filas: FilaDeposito[] = depositos.map(({ x, nombre, vinculo, depositadoEn, estado }) => ({
        x,
        nombre,
        vinculo,
        depositadoEn,
        estado,
    }));

    return (
        <RecuperacionSesionLayout
            pid={pid}
            bovedaNombre={boveda?.nombre}
            rol="bp"
            activeKey="estado"
            sesion={sesion}
            nombreMostrado={bp.nombreDeclarado ?? nombreRecordado(pid)}
        >
            {err && <div className="alert alert-danger py-2 small">{err}</div>}

            {bp.dek && bp.reconstruidoEn && (
                <div className="alert alert-success py-2 small d-flex align-items-center flex-wrap gap-2">
                    <i className="fas fa-check-circle" />
                    <span>
                        Ya reconstruiste la llave maestra y accediste a los activos a las {fmtHora(bp.reconstruidoEn)}.
                    </span>
                    <button
                        type="button"
                        className="btn btn-link btn-sm p-0 ms-auto fw-bold"
                        onClick={() => navigate(`/recuperacion/${pid}/activos`)}
                    >
                        Ir a Activos <i className="fas fa-arrow-right ms-1" />
                    </button>
                </div>
            )}

            <div className="row g-4 mb-4">
                <div className="col-md-8">
                    <div className="stat-card h-100">
                        <h2 className="fw-bold mb-1">Panel de Reconstrucción</h2>
                        <p className="text-muted">Gestiona los fragmentos recibidos para restaurar el patrimonio.</p>
                        <div className="mt-4">
                            <div className="d-flex justify-content-between align-items-center mb-2">
                                <span className="recuperacion-label">Progreso del quórum (k={k})</span>
                                <span className="fw-bold">
                                    {validCount} / {k} fragmentos
                                </span>
                            </div>
                            <div className="progress" style={{ height: 12, borderRadius: 10, background: '#f1f5f9' }}>
                                <div
                                    className="progress-bar progress-bar-striped progress-bar-animated"
                                    style={{
                                        width: `${pct}%`,
                                        background: puedeReconstruir ? 'var(--success-green, #2ecc71)' : 'var(--ipn-maroon)',
                                    }}
                                />
                            </div>
                            {n > 0 && (
                                <p className="text-muted small mt-2 mb-0">
                                    {depositos.length} de {n} custodios han depositado en total.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="stat-card h-100 d-flex flex-column justify-content-center text-center">
                        <span className="recuperacion-label mb-3">Acción criptográfica</span>
                        <button
                            type="button"
                            className="btn btn-ipn py-3 shadow"
                            disabled={!puedeReconstruir || reconstruyendo}
                            onClick={reconstruir}
                        >
                            <i className="fas fa-unlock-alt me-2" /> Recuperar
                        </button>
                        {!puedeReconstruir && (
                            <p className="text-muted small mt-2 mb-0">
                                Faltan {Math.max(k - validCount, 0)} fragmento(s) válido(s).
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <DepositosTable filas={filas} />

            {reconstruyendo && (
                <div className="modal fade show d-block" tabIndex={-1} data-bs-backdrop="static" style={{ background: 'rgba(15,23,42,0.6)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg text-center" style={{ borderRadius: 20, overflow: 'hidden' }}>
                            <div style={{ height: 6, background: 'linear-gradient(90deg,#621132,#003366)' }} />
                            <div className="modal-body p-5">
                                <div className="mb-4 text-primary animate__animated animate__pulse animate__infinite">
                                    <i className="fas fa-microchip fa-4x" />
                                </div>
                                <h4 className="fw-bold">Procesando interpolación</h4>
                                <p className="text-muted small">Ejecutando el polinomio de Shamir en tu navegador…</p>
                                <p
                                    className="small fw-bold text-uppercase mt-3 mb-0"
                                    style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--ipn-maroon)' }}
                                >
                                    {progresoTxt}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </RecuperacionSesionLayout>
    );
}
