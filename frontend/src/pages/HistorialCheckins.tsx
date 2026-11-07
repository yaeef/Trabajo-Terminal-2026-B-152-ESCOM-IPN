import { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '../components/layout/DashboardLayout';
import VerificationStatusWidget from '../components/VerificationStatusWidget';
import { dmsService } from '../services/dms.service';
import { useNotice } from '../store/NoticeContext';
import type { CheckinHistoryResponse, ProtocoloVidaResponse } from '../types/dms.types';
import { formatRelativo, getMetodoIconPrefix, getMetodoInfo, getStatusInfo, splitFechaHora } from '../utils/checkins';
import './HistorialCheckins.css';

const DEFAULT_PERIODICIDAD_DIAS = 60; // mismo fallback que usa el backend
const PAGE_SIZE = 10;

export default function HistorialCheckins() {
    const [protocoloVida, setProtocoloVida] = useState<ProtocoloVidaResponse | null>(null);
    const [historial, setHistorial] = useState<CheckinHistoryResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const { notifyError } = useNotice();

    useEffect(() => {
        let cancelled = false;

        Promise.all([dmsService.getProtocoloVida(), dmsService.getCheckinHistory()])
            .then(([protocolo, checkins]) => {
                if (cancelled) return;
                setProtocoloVida(protocolo);
                setHistorial(checkins);
            })
            .catch(() => {
                if (!cancelled) notifyError('No se pudo cargar el historial de check-ins.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const inactividadPermitida = historial?.inactividad_permitida ?? DEFAULT_PERIODICIDAD_DIAS;
    const statusInfo = historial ? getStatusInfo(historial.estado_interruptor) : null;

    // El backend ya entrega los logs ordenados desc (más recientes primero),
    // así que paginar del lado del cliente no altera el orden esperado.
    const totalLogs = historial?.logs.length ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalLogs / PAGE_SIZE));
    const logsPagina = useMemo(() => {
        if (!historial) return [];
        const start = (page - 1) * PAGE_SIZE;
        return historial.logs.slice(start, start + PAGE_SIZE);
    }, [historial, page]);

    return (
        <DashboardLayout activeItem="checkins" topBarLabel="Auditoría del Sistema">
            <div className="d-flex justify-content-between align-items-center mb-5 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">Historial de Check-in</h2>
                    <p className="text-muted m-0">Registro cronológico de señales de vida recibidas por los nodos.</p>
                </div>
                <VerificationStatusWidget protocoloVida={protocoloVida} loading={loading} />
            </div>

            {/* Stats Overview — datos reales de GET /propietario/checkins */}
            <div className="row g-4 mb-5">
                <div className="col-md-4">
                    <div className="stat-card h-100">
                        <p className="verif-label mb-2">Inactividad Permitida</p>
                        <h3 className="fw-bold m-0" style={{ color: 'var(--escom-blue)' }}>
                            {loading ? '—' : `${inactividadPermitida} Días`}
                        </h3>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="stat-card h-100" style={{ borderTopColor: 'var(--ipn-maroon)' }}>
                        <p className="verif-label mb-2">Última Señal</p>
                        <h3 className="fw-bold m-0" style={{ color: 'var(--ipn-maroon)' }}>
                            {loading || !historial?.ultima_senal ? '—' : formatRelativo(historial.ultima_senal)}
                        </h3>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="stat-card h-100" style={{ borderTopColor: statusInfo?.colorVar ?? '#e2e8f0' }}>
                        <p className="verif-label mb-2">Estado del Interruptor</p>
                        <h3 className="fw-bold m-0" style={{ color: statusInfo?.colorVar ?? undefined }}>
                            {loading ? '—' : statusInfo?.label}
                        </h3>
                    </div>
                </div>
            </div>

            {/* Logs Table */}
            <div className="vault-card">
                <div className="table-responsive">
                    <table className="table table-hover align-middle mb-0">
                        <thead style={{ background: '#f8fafc' }}>
                            <tr>
                                <th className="border-0 ps-4 py-3 small text-muted text-uppercase fw-bold">Marca de Tiempo</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Método</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Identificador</th>
                                <th className="border-0 py-3 small text-muted text-uppercase fw-bold">Red / IP</th>
                                <th className="border-0 pe-4 py-3 small text-muted text-uppercase fw-bold text-end">Impacto</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr>
                                    <td colSpan={5} className="text-center text-muted py-5">
                                        Cargando historial...
                                    </td>
                                </tr>
                            )}

                            {!loading && historial && historial.logs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="text-center text-muted py-5">
                                        <i className="fas fa-calendar-check fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }}></i>
                                        Aún no hay check-ins registrados.
                                    </td>
                                </tr>
                            )}

                            {!loading &&
                                logsPagina.map((log, idx) => {
                                    const { hora, fecha } = splitFechaHora(log.fecha_prueba);
                                    const metodoInfo = getMetodoInfo(log.metodo);
                                    const iconPrefix = getMetodoIconPrefix(log.metodo);

                                    // ip_origen es NULL cuando el origen es un webhook (Telegram) sin IP
                                    // de cliente, o cuando se anonimizó por "derecho al olvido".
                                    const redLabel = log.ip_origen
                                        ? log.ip_origen
                                        : log.metodo === 'telegram_bot'
                                        ? 'Webhook (Telegram)'
                                        : '—';

                                    return (
                                        <tr key={idx}>
                                            <td className="ps-4">
                                                <div className="fw-bold">{hora}</div>
                                                <div className="text-muted small">{fecha}</div>
                                            </td>
                                            <td>
                                                <span className="source-tag">
                                                    <i className={`${iconPrefix} ${metodoInfo.icon} me-2 ${metodoInfo.colorClass}`}></i>
                                                    {metodoInfo.label}
                                                </span>
                                            </td>
                                            <td>{log.identificador ?? '—'}</td>
                                            <td>
                                                <span className="ip-badge">{redLabel}</span>
                                            </td>
                                            <td className="pe-4 text-end text-success fw-bold">+{log.dias_extendidos}d</td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>

                {!loading && totalLogs > PAGE_SIZE && (
                    <div className="d-flex justify-content-between align-items-center px-4 py-3 border-top">
                        <span className="small text-muted">
                            Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalLogs)} de {totalLogs}
                        </span>
                        <div className="d-flex gap-2">
                            <button
                                type="button"
                                className="btn btn-light btn-sm rounded-pill px-3 border"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                            >
                                <i className="fas fa-chevron-left me-1"></i> Anterior
                            </button>
                            <span className="small text-muted align-self-center px-2">
                                Página {page} de {totalPages}
                            </span>
                            <button
                                type="button"
                                className="btn btn-light btn-sm rounded-pill px-3 border"
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                            >
                                Siguiente <i className="fas fa-chevron-right ms-1"></i>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </DashboardLayout>
    );
}