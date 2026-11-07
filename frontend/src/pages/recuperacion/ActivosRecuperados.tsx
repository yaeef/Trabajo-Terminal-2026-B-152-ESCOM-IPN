import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import RecuperacionSesionLayout from '../../components/recuperacion/RecuperacionSesionLayout';
import { recuperacionService } from '../../services/recuperacion.service';
import { activosService } from '../../services/activos.service';
import { useRecuperacionSession } from '../../store/RecuperacionSessionContext';
import { decryptToBlob, saveBlob, humanBytes } from '../../crypto/assetCrypto';
import { useNotice } from '../../store/NoticeContext';
import { getApiErrorMessage } from '../../utils/errors';
import { plantillaById, parseEnvelope, type CredentialEnvelope } from '../../credentials/templates';
import CredentialViewModal from '../../credentials/CredentialViewModal';
import type { BovedaRecuperacionResponse, SesionEstadoResponse } from '../../types/recuperacion.types';
import type { ActivoResponse } from '../../types/activos.types';

/**
 * boveda_desbloqueada.html — una vez reconstruida la DEK en SesionBP, este
 * es el único lugar donde se descifra/descarga cada activo: se pide un SAS
 * de lectura, se trae el blob directo de Azure, y se descifra localmente.
 * El servidor nunca ve la DEK ni el contenido en claro.
 */
export default function ActivosRecuperados() {
    const { pid = '' } = useParams();
    const navigate = useNavigate();
    const { bp } = useRecuperacionSession();

    const [boveda, setBoveda] = useState<BovedaRecuperacionResponse | null>(null);
    const [sesion, setSesion] = useState<SesionEstadoResponse | null>(null);
    const [activos, setActivos] = useState<ActivoResponse[]>([]);
    const { notifyError } = useNotice();
    const [descargandoId, setDescargandoId] = useState<number | null>(null);
    const [viewer, setViewer] = useState<{ activo: ActivoResponse; envelope: CredentialEnvelope } | null>(null);

    useEffect(() => {
        if (!bp || bp.pid !== pid || !bp.dek) {
            navigate(`/recuperacion/${pid}/bp`, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bp, pid]);

    useEffect(() => {
        if (!pid) return;
        recuperacionService.buscarBoveda(pid).then(setBoveda).catch(() => undefined);
        recuperacionService.getSesion(pid).then(setSesion).catch(() => undefined);
        recuperacionService
            .listarActivos(pid)
            .then(setActivos)
            .catch((e) => notifyError(getApiErrorMessage(e, 'No se pudo listar los activos.')));
    }, [pid]);

    const descargar = async (a: ActivoResponse) => {
        if (!bp?.dek) return;
        setDescargandoId(a.id);
        try {
            const dl = await recuperacionService.prepararDescarga(pid, a.id);
            const ct = await activosService.getBlob(dl.sas_url);
            const blob = await decryptToBlob(bp.dek, dl.iv_hex, ct, dl.mime);
            saveBlob(dl.nombre_original, blob);
        } catch (e) {
            notifyError(getApiErrorMessage(e, `No se pudo descargar "${a.nombre_original}".`));
        } finally {
            setDescargandoId(null);
        }
    };

    // Activos de plantilla (credenciales) se VEN, no se descargan como archivo
    // — desde ahí mismo se puede pedir el PDF/JSON, igual que en Gestionar
    // Bóveda. Sin onEditar: en recuperación es de solo lectura.
    const verCredencial = async (a: ActivoResponse) => {
        if (!bp?.dek) return;
        setDescargandoId(a.id);
        try {
            const dl = await recuperacionService.prepararDescarga(pid, a.id);
            const ct = await activosService.getBlob(dl.sas_url);
            const blob = await decryptToBlob(bp.dek, dl.iv_hex, ct, dl.mime);
            setViewer({ activo: a, envelope: parseEnvelope(await blob.text()) });
        } catch (e) {
            notifyError(getApiErrorMessage(e, `No se pudo abrir "${a.nombre_original}".`));
        } finally {
            setDescargandoId(null);
        }
    };

    if (!bp || bp.pid !== pid || !bp.dek) return null;

    return (
        <RecuperacionSesionLayout
            pid={pid}
            bovedaNombre={boveda?.nombre}
            rol="bp"
            activeKey="activos"
            sesion={sesion}
            nombreMostrado={bp.nombreDeclarado}
        >
            <div className="mb-4">
                <div className="d-flex align-items-center gap-3 flex-wrap">
                    <h2 className="fw-bold m-0">Patrimonio Recuperado</h2>
                    <span className="badge bg-success-subtle text-success border border-success rounded-pill px-3">
                        Llave reconstruida
                    </span>
                </div>
                <p className="text-muted mt-2">
                    Los activos siguen cifrados en el servidor; se descifran en tu navegador al descargarlos.
                </p>
            </div>

            {activos.length === 0 ? (
                <div className="text-center text-muted py-5">
                    <i className="fas fa-box-open fa-2x mb-3 d-block" style={{ color: '#cbd5e1' }} />
                    Esta bóveda no tiene activos.
                </div>
            ) : (
                <div className="row g-4">
                    {activos.map((a) => {
                        const tpl = plantillaById(a.plantilla);
                        return (
                            <div className="col-md-4" key={a.id}>
                                <div className="stat-card h-100 text-center">
                                    <div className="mb-3">
                                        <i
                                            className={`fas ${tpl ? tpl.icon : 'fa-file-shield'} fa-2x`}
                                            style={{ color: 'var(--escom-blue)' }}
                                        />
                                    </div>
                                    <h6 className="fw-bold mb-1 text-truncate" title={a.nombre_original}>
                                        {a.nombre_original}
                                    </h6>
                                    <p className="text-muted small mb-4">
                                        {tpl ? tpl.label : humanBytes(a.tamano_bytes)}
                                    </p>
                                    <button
                                        type="button"
                                        className="btn btn-ipn w-100"
                                        disabled={descargandoId === a.id}
                                        onClick={() => (tpl ? verCredencial(a) : descargar(a))}
                                    >
                                        {descargandoId === a.id ? (
                                            'Descifrando…'
                                        ) : tpl ? (
                                            <>
                                                <i className="fas fa-eye me-2" /> Ver
                                            </>
                                        ) : (
                                            <>
                                                <i className="fas fa-download me-2" /> Descargar
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {viewer && (
                <CredentialViewModal
                    envelope={viewer.envelope}
                    nombreActivo={viewer.activo.nombre_original}
                    bovedaNombre={boveda?.nombre ?? ''}
                    onClose={() => setViewer(null)}
                />
            )}

            <div className="mt-5 p-4 rounded-4 border border-warning bg-warning-subtle text-warning-emphasis">
                <div className="d-flex gap-3 align-items-center">
                    <i className="fas fa-exclamation-triangle fa-2x" />
                    <div>
                        <h6 className="fw-bold mb-0">La llave de descifrado es volátil</h6>
                        <p className="small mb-0">
                            Vive solo en la memoria de esta pestaña. Descarga lo que necesites antes de cerrarla —
                            para volver a descifrar tendrás que reingresar con la pass-phrase de sesión y esperar a
                            que se junten los fragmentos otra vez.
                        </p>
                    </div>
                </div>
            </div>
        </RecuperacionSesionLayout>
    );
}
