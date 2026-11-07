import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../components/layout/DashboardLayout';
import VerificationStatusWidget from '../components/VerificationStatusWidget';
import { useAuth } from '../store/AuthContext';
import { useNotice } from '../store/NoticeContext';
import { dmsService } from '../services/dms.service';
import { channelsService } from '../services/channels.service';
import { userService } from '../services/user.service';
import { purgeAll } from '../crypto/sensitiveMemory';
import type { ProtocoloVidaResponse } from '../types/dms.types';
import type { TelegramLinkCodeResponse } from '../types/channels.types';
import { getApiErrorMessage } from '../utils/errors';
import './Configuracion.css';

const CONFIRM_WORD = 'ELIMINAR';

// Valores fijos del protocolo de vida (deben coincidir con el backend:
// schemas/user.py PERIODICIDAD_*_OPCIONES y el CHECK de la tabla propietario).
const UMBRAL_OPCIONES = [30, 45, 60];
const GRACIA_OPCIONES = [7, 14, 21];
const DEFAULT_UMBRAL = 60;
const DEFAULT_GRACIA = 7;

export default function Configuracion() {
    const { user, refreshUser } = useAuth();
    const { notifyError, notifySuccess } = useNotice();
    const navigate = useNavigate();

    // --- Zona crítica: eliminar cuenta ---
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deletePassword, setDeletePassword] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [deleteErr, setDeleteErr] = useState('');

    // --- Protocolo de vida ---
    const [protocoloVida, setProtocoloVida] = useState<ProtocoloVidaResponse | null>(null);
    const [loadingProtocolo, setLoadingProtocolo] = useState(true);
    const [umbral, setUmbral] = useState(DEFAULT_UMBRAL);
    const [gracia, setGracia] = useState(DEFAULT_GRACIA);
    const [savingUmbral, setSavingUmbral] = useState(false);

    // --- Telegram ---
    const [telegramLinkInfo, setTelegramLinkInfo] = useState<TelegramLinkCodeResponse | null>(null);
    const [telegramSegundosRestantes, setTelegramSegundosRestantes] = useState(0);
    const [telegramLoading, setTelegramLoading] = useState(false);

    // --- Correo secundario ---
    const [correoFormAbierto, setCorreoFormAbierto] = useState(false);
    const [correoNuevo, setCorreoNuevo] = useState('');
    const [correoLoading, setCorreoLoading] = useState(false);
    const [correoSolicitado, setCorreoSolicitado] = useState('');

    useEffect(() => {
        let cancelled = false;
        dmsService
            .getProtocoloVida()
            .then((data) => {
                if (cancelled) return;
                setProtocoloVida(data);
                setUmbral(data.periodicidad_prueba ?? DEFAULT_UMBRAL);
                setGracia(data.periodicidad_periodo_gracia ?? DEFAULT_GRACIA);
            })
            .catch(() => {
                if (!cancelled) setProtocoloVida(null);
            })
            .finally(() => {
                if (!cancelled) setLoadingProtocolo(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Cuenta regresiva del enlace de vinculación de Telegram.
    useEffect(() => {
        if (!telegramLinkInfo || telegramSegundosRestantes <= 0) return;
        const t = setTimeout(() => setTelegramSegundosRestantes((s) => s - 1), 1000);
        return () => clearTimeout(t);
    }, [telegramLinkInfo, telegramSegundosRestantes]);

    const handleUpdateUmbrales = async () => {
        setSavingUmbral(true);
        try {
            const actualizado = await dmsService.updateProtocoloVida({
                periodicidad_prueba: umbral,
                periodicidad_periodo_gracia: gracia,
            });
            setProtocoloVida(actualizado);
            notifySuccess('Umbrales actualizados correctamente.');
        } catch (err) {
            notifyError(getApiErrorMessage(err, 'No se pudieron actualizar los umbrales.'));
        } finally {
            setSavingUmbral(false);
        }
    };

    const handleVincularTelegram = async () => {
        setTelegramLoading(true);
        try {
            const info = await channelsService.createTelegramLinkCode();
            setTelegramLinkInfo(info);
            setTelegramSegundosRestantes(info.expira_en_segundos);
        } catch (err) {
            notifyError(getApiErrorMessage(err, 'No se pudo generar el enlace de vinculación.'));
        } finally {
            setTelegramLoading(false);
        }
    };

    const handleRefrescarEstadoTelegram = async () => {
        setTelegramLoading(true);
        try {
            await refreshUser();
            setTelegramLinkInfo(null);
        } finally {
            setTelegramLoading(false);
        }
    };

    const handleDesvincularTelegram = async () => {
        setTelegramLoading(true);
        try {
            await channelsService.unlinkTelegram();
            await refreshUser();
        } catch (err) {
            notifyError(getApiErrorMessage(err, 'No se pudo desvincular Telegram.'));
        } finally {
            setTelegramLoading(false);
        }
    };

    const handleSolicitarCorreoSecundario = async (e: React.FormEvent) => {
        e.preventDefault();

        if (correoNuevo === user?.correo) {
            notifyError('El correo alternativo debe ser distinto al correo principal.');
            return;
        }

        setCorreoLoading(true);
        try {
            await channelsService.requestSecondaryEmail(correoNuevo);
            setCorreoSolicitado(correoNuevo);
            setCorreoFormAbierto(false);
            setCorreoNuevo('');
        } catch (err) {
            notifyError(getApiErrorMessage(err, 'No se pudo enviar el correo de confirmación.'));
        } finally {
            setCorreoLoading(false);
        }
    };

    const handleDesvincularCorreo = async () => {
        setCorreoLoading(true);
        try {
            await channelsService.unlinkSecondaryEmail();
            await refreshUser();
            setCorreoSolicitado('');
        } catch (err) {
            notifyError(getApiErrorMessage(err, 'No se pudo desvincular el correo alternativo.'));
        } finally {
            setCorreoLoading(false);
        }
    };

    const cerrarModalEliminar = () => {
        if (deleting) return;
        setDeleteOpen(false);
        setDeletePassword('');
        setDeleteConfirm('');
        setDeleteErr('');
    };

    const handleEliminarCuenta = async () => {
        setDeleting(true);
        setDeleteErr('');
        try {
            await userService.requestDeletion(deletePassword);
            // No se borró nada aún: la cuenta quedó en cola de eliminación.
            purgeAll(); // por higiene: barre llaves/fragmentos que sigan en RAM
            await refreshUser(); // ahora trae eliminacion_solicitada_en
            navigate('/cuenta-en-eliminacion', { replace: true });
        } catch (err) {
            setDeleteErr(getApiErrorMessage(err, 'No se pudo programar la eliminación.'));
            setDeleting(false);
        }
    };

    const telegramVinculado = Boolean(user?.id_telegram);
    const correoVinculado = Boolean(user?.correo_sec);
    const puedeEliminar = deletePassword.length > 0 && deleteConfirm.trim().toUpperCase() === CONFIRM_WORD;

    return (
        <DashboardLayout activeItem="configuracion" topBarLabel="Ajustes del Sistema">
            <div className="d-flex justify-content-between align-items-center mb-5 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">Ajustes del Sistema</h2>
                    <p className="text-muted m-0">Define las reglas de herencia y gestiona tu identidad.</p>
                </div>
                <VerificationStatusWidget protocoloVida={protocoloVida} loading={loadingProtocolo} />
            </div>

            {/* SECCIÓN 1: PROTOCOLO DE VIDA */}
            <section className="config-section">
                <div className="section-title">
                    <i className="fas fa-heartbeat"></i> Protocolo de Vida (Dead Man's Switch)
                </div>
                <p className="section-desc">
                    Reglas para determinar la inactividad y proceder con la fragmentación de llaves.
                </p>

                <div className="row g-4">
                    <div className="col-md-6">
                        <label className="form-label">Umbral de Inactividad Total</label>
                        <select
                            className="form-select shadow-none"
                            value={umbral}
                            onChange={(e) => setUmbral(Number(e.target.value))}
                            disabled={loadingProtocolo}
                        >
                            {UMBRAL_OPCIONES.map((dias) => (
                                <option key={dias} value={dias}>
                                    {dias} Días{dias === DEFAULT_UMBRAL ? ' (Recomendado)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="col-md-6">
                        <label className="form-label">Periodo de Gracia Crítico</label>
                        <select
                            className="form-select shadow-none"
                            value={gracia}
                            onChange={(e) => setGracia(Number(e.target.value))}
                            disabled={loadingProtocolo}
                        >
                            {GRACIA_OPCIONES.map((dias) => (
                                <option key={dias} value={dias}>
                                    {dias} Días
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="d-flex flex-wrap gap-2 mt-4">
                    <button
                        className="btn btn-ipn"
                        onClick={handleUpdateUmbrales}
                        disabled={loadingProtocolo || savingUmbral}
                    >
                        {savingUmbral ? 'Actualizando...' : 'Actualizar Umbrales'}
                    </button>
                </div>
                <p className="section-desc mt-3 mb-0">
                    Iniciar sesión en el sistema cuenta como señal de vida y reinicia el contador de
                    inactividad automáticamente.
                </p>
            </section>

            {/* SECCIÓN 2: CANALES */}
            <section className="config-section">
                <div className="section-title">
                    <i className="fas fa-satellite-dish"></i> Canales de Comunicación
                </div>
                <p className="section-desc">
                    Vincula servicios para recibir alertas y realizar check-ins automáticos.
                </p>

                {/* Telegram */}
                <div className="integration-box">
                    <div className="d-flex align-items-center">
                        <div className={`integration-status-dot ${telegramVinculado ? 'linked' : 'unlinked'}`}></div>
                        <div>
                            <div className="fw-bold small">Telegram Bot</div>
                            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                {telegramVinculado ? 'Vinculado' : 'No configurado'}
                            </div>
                        </div>
                    </div>
                    {telegramVinculado ? (
                        <button
                            className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                            onClick={handleDesvincularTelegram}
                            disabled={telegramLoading}
                        >
                            {telegramLoading ? 'Desvinculando...' : 'Desvincular'}
                        </button>
                    ) : (
                        <button
                            className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                            onClick={handleVincularTelegram}
                            disabled={telegramLoading}
                        >
                            {telegramLoading ? 'Generando...' : 'Vincular'}
                        </button>
                    )}
                </div>

                {telegramLinkInfo && !telegramVinculado && (
                    <div className="p-3 rounded-4 bg-light small mb-3">
                        <p className="mb-2">
                            Abre este enlace en Telegram para completar la vinculación
                            {telegramSegundosRestantes > 0 && (
                                <> (expira en {telegramSegundosRestantes}s)</>
                            )}
                            :
                        </p>
                        <div className="d-flex gap-2 flex-wrap">
                            <a
                                href={telegramLinkInfo.deep_link}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-ipn btn-sm"
                            >
                                Abrir Telegram <i className="fab fa-telegram ms-1"></i>
                            </a>
                            <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary rounded-pill"
                                onClick={handleRefrescarEstadoTelegram}
                                disabled={telegramLoading}
                            >
                                Ya vinculé, actualizar
                            </button>
                        </div>
                    </div>
                )}

                {/* Correo Alternativo */}
                <div className="integration-box">
                    <div className="d-flex align-items-center">
                        <div className={`integration-status-dot ${correoVinculado ? 'linked' : 'unlinked'}`}></div>
                        <div>
                            <div className="fw-bold">Correo Alternativo</div>
                            <div className="small text-muted">
                                {correoVinculado ? user?.correo_sec : 'No configurado'}
                            </div>
                        </div>
                    </div>
                    {correoVinculado ? (
                        <button
                            className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                            onClick={handleDesvincularCorreo}
                            disabled={correoLoading}
                        >
                            {correoLoading ? 'Desvinculando...' : 'Desvincular'}
                        </button>
                    ) : (
                        <button
                            className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                            onClick={() => setCorreoFormAbierto((prev) => !prev)}
                        >
                            Vincular
                        </button>
                    )}
                </div>

                {correoSolicitado && !correoVinculado && (
                    <div className="p-3 rounded-4 bg-light small mb-3 text-muted">
                        <i className="fas fa-info-circle me-1 text-primary"></i>
                        Revisa la bandeja de entrada de <strong>{correoSolicitado}</strong> para confirmar la
                        vinculación. El enlace expira en 30 minutos.
                    </div>
                )}

                {correoFormAbierto && !correoVinculado && (
                    <form onSubmit={handleSolicitarCorreoSecundario} className="d-flex gap-2 flex-wrap mb-3">
                        <input
                            type="email"
                            className="form-control shadow-none"
                            style={{ maxWidth: 280 }}
                            placeholder="correo.alterno@ejemplo.com"
                            value={correoNuevo}
                            onChange={(e) => setCorreoNuevo(e.target.value)}
                            required
                        />
                        <button type="submit" className="btn btn-ipn btn-sm" disabled={correoLoading}>
                            {correoLoading ? 'Enviando...' : 'Enviar confirmación'}
                        </button>
                    </form>
                )}
            </section>

            {/* SECCIÓN 3: PERFIL DE USUARIO */}
            <section className="config-section">
                <div className="section-title">
                    <i className="fas fa-user-circle"></i> Perfil de Usuario
                </div>
                <p className="section-desc">Información básica del propietario de la cuenta maestra.</p>
                <div className="d-flex align-items-center justify-content-between p-3 border rounded-4 bg-light bg-opacity-25 flex-wrap gap-3">
                    <div className="d-flex align-items-center">
                        <img
                            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
                                user?.nombre ?? user?.username ?? 'Usuario'
                            )}&background=003366&color=fff`}
                            className="rounded-circle border me-3"
                            width={50}
                            height={50}
                            alt="Avatar"
                        />
                        <div>
                            <div className="fw-bold">{user?.nombre ?? user?.username}</div>
                            <div className="text-muted small">{user?.correo}</div>
                        </div>
                    </div>
                    <button className="btn btn-outline-primary px-4" onClick={() => navigate('/perfil')}>
                        Editar Perfil <i className="fas fa-user-edit ms-2"></i>
                    </button>
                </div>
            </section>

            {/* SECCIÓN 4: ZONA CRÍTICA */}
            <section className="config-section config-section-danger">
                <div className="section-title text-danger">
                    <i className="fas fa-exclamation-triangle"></i> Zona Crítica
                </div>
                <p className="section-desc">Acciones irreversibles sobre el patrimonio digital.</p>
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                    <div>
                        <div className="fw-bold">Eliminar Patrimonio Permanente</div>
                        <div className="text-muted small">
                            La cuenta entra en una cola de <strong>30 días</strong>. Si no vuelves a
                            iniciar sesión y cancelar en ese plazo, se borran todas tus bóvedas,
                            activos cifrados, compromisos y custodios, y tu identidad se anonimiza.
                        </div>
                    </div>
                    <button
                        className="btn btn-danger rounded-pill px-4"
                        onClick={() => setDeleteOpen(true)}
                    >
                        Programar eliminación
                    </button>
                </div>
            </section>

            {deleteOpen && (
                <div
                    className="modal fade show d-block"
                    tabIndex={-1}
                    style={{ background: 'rgba(15,23,42,0.6)' }}
                >
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg" style={{ borderRadius: 20, overflow: 'hidden' }}>
                            <div style={{ height: 6, background: 'var(--danger-red, #ef4444)' }} />
                            <div className="modal-body p-5">
                                <div className="text-center mb-3 text-danger">
                                    <i className="fas fa-triangle-exclamation fa-3x" />
                                </div>
                                <h4 className="fw-bold text-center mb-1">Programar eliminación</h4>
                                <p className="text-muted small text-center mb-4">
                                    Tu cuenta entrará en una cola de <strong>30 días</strong> y quedará
                                    bloqueada. Si inicias sesión y cancelas antes de que venza el plazo,
                                    no se pierde nada. Si no, se borran <strong>todas tus bóvedas</strong>,
                                    activos cifrados, compromisos VSS y custodios, y tu identidad se
                                    anonimiza. Esto también <strong>pausa la recuperación por custodios</strong>.
                                </p>

                                {deleteErr && (
                                    <div className="alert alert-danger py-2 small">{deleteErr}</div>
                                )}

                                <label className="form-label-b d-block mb-1">Contraseña de la cuenta</label>
                                <input
                                    type="password"
                                    className="form-control shadow-none mb-3"
                                    autoComplete="current-password"
                                    value={deletePassword}
                                    onChange={(e) => setDeletePassword(e.target.value)}
                                    disabled={deleting}
                                />

                                <label className="form-label-b d-block mb-1">
                                    Escribe <code>{CONFIRM_WORD}</code> para confirmar
                                </label>
                                <input
                                    type="text"
                                    className="form-control shadow-none mb-4"
                                    value={deleteConfirm}
                                    onChange={(e) => setDeleteConfirm(e.target.value)}
                                    disabled={deleting}
                                />

                                <div className="d-flex gap-3">
                                    <button
                                        className="btn btn-light w-100 rounded-pill"
                                        onClick={cerrarModalEliminar}
                                        disabled={deleting}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        className="btn btn-danger w-100 rounded-pill"
                                        onClick={handleEliminarCuenta}
                                        disabled={!puedeEliminar || deleting}
                                    >
                                        {deleting ? 'Programando…' : 'Programar eliminación'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
