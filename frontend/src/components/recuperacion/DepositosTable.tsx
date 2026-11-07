import './DepositosTable.css';

function fmtFechaHora(iso: string): string {
    return new Date(iso).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export interface FilaDeposito {
    x: number;
    nombre: string;
    vinculo: string;
    depositadoEn: string;
    /** undefined = vista de custodio: no se puede saber si es válido (no tiene la llave del BP). */
    estado?: 'valido' | 'invalido';
}

export default function DepositosTable({ filas }: { filas: FilaDeposito[] }) {
    return (
        <div className="recuperacion-table-card">
            <div className="p-4 border-bottom bg-light d-flex justify-content-between align-items-center">
                <h6 className="m-0 fw-bold">
                    <i className="fas fa-list-check me-2" />
                    Cola de Fragmentos
                </h6>
                <span className="badge bg-white text-dark border small fw-light">Cifrado extremo a extremo</span>
            </div>
            <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                    <thead style={{ background: '#f8fafc' }}>
                        <tr>
                            <th className="ps-4 py-3 recuperacion-label">Custodio</th>
                            <th className="py-3 recuperacion-label text-center">Estado</th>
                            <th className="py-3 recuperacion-label text-end pe-4">Depositado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filas.map((f) => (
                            <tr key={f.x}>
                                <td className="ps-4">
                                    <div className="fw-bold">{f.nombre}</div>
                                    <small className="text-muted">{f.vinculo}</small>
                                </td>
                                <td className="text-center">
                                    {f.estado === 'invalido' ? (
                                        <span className="recuperacion-vss-tag invalido">Inválido</span>
                                    ) : f.estado === 'valido' ? (
                                        <span className="recuperacion-vss-tag valido">Verificado</span>
                                    ) : (
                                        <span className="recuperacion-vss-tag neutro">Depositado</span>
                                    )}
                                </td>
                                <td className="text-end pe-4 small text-muted">{fmtFechaHora(f.depositadoEn)}</td>
                            </tr>
                        ))}
                        {filas.length === 0 && (
                            <tr>
                                <td colSpan={3} className="text-center text-muted py-4">
                                    Aún no hay depósitos.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
