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
import { getLang, t } from '../i18n';

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
        const id = setTimeout(() => setTelegramSegundosRestantes((s) => s - 1), 1000);
        return () => clearTimeout(id);
    }, [telegramLinkInfo, telegramSegundosRestantes]);

    const handleUpdateUmbrales = async () => {
        setSavingUmbral(true);
        try {
            const actualizado = await dmsService.updateProtocoloVida({
                periodicidad_prueba: umbral,
                periodicidad_periodo_gracia: gracia,
            });
            setProtocoloVida(actualizado);
            notifySuccess(t('Umbrales actualizados correctamente.', 'Thresholds updated successfully.'));
        } catch (err) {
            notifyError(getApiErrorMessage(err, t('No se pudieron actualizar los umbrales.', "Couldn't update the thresholds.")));
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
            notifyError(getApiErrorMessage(err, t('No se pudo generar el enlace de vinculación.', "Couldn't generate the linking link.")));
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
            notifyError(getApiErrorMessage(err, t('No se pudo desvincular Telegram.', "Couldn't unlink Telegram.")));
        } finally {
            setTelegramLoading(false);
        }
    };

    const handleSolicitarCorreoSecundario = async (e: React.FormEvent) => {
        e.preventDefault();

        if (correoNuevo === user?.correo) {
            notifyError(t('El correo alternativo debe ser distinto al correo principal.', 'The alternate email must be different from the primary email.'));
            return;
        }

        setCorreoLoading(true);
        try {
            await channelsService.requestSecondaryEmail(correoNuevo);
            setCorreoSolicitado(correoNuevo);
            setCorreoFormAbierto(false);
            setCorreoNuevo('');
        } catch (err) {
            notifyError(getApiErrorMessage(err, t('No se pudo enviar el correo de confirmación.', "Couldn't send the confirmation email.")));
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
            notifyError(getApiErrorMessage(err, t('No se pudo desvincular el correo alternativo.', "Couldn't unlink the alternate email.")));
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
            setDeleteErr(getApiErrorMessage(err, t('No se pudo programar la eliminación.', "Couldn't schedule the deletion.")));
            setDeleting(false);
        }
    };

    const telegramVinculado = Boolean(user?.id_telegram);
    const correoVinculado = Boolean(user?.correo_sec);
    // Palabra de confirmación (solo la valida el frontend; el backend pide la contraseña).
    const CONFIRM_WORD = t('ELIMINAR', 'DELETE');
    const puedeEliminar = deletePassword.length > 0 && deleteConfirm.trim().toUpperCase() === CONFIRM_WORD;

    return (
        <DashboardLayout activeItem="configuracion" topBarLabel={t('Ajustes del Sistema', 'System Settings')}>
            <div className="d-flex justify-content-between align-items-center mb-5 flex-wrap gap-3">
                <div>
                    <h2 className="fw-bold mb-1">{t('Ajustes del Sistema', 'System Settings')}</h2>
                    <p className="text-muted m-0">{t('Define las reglas de herencia y gestiona tu identidad.', 'Define the inheritance rules and manage your identity.')}</p>
                </div>
                <VerificationStatusWidget protocoloVida={protocoloVida} loading={loadingProtocolo} />
            </div>

            {/* SECCIÓN 1: PROTOCOLO DE VIDA */}
            <section className="config-section">
                <div className="section-title">
                    <i className="fas fa-heartbeat"></i> {t('Protocolo de Vida', 'Life Protocol')} (Dead Man's Switch)
                </div>
                <p className="section-desc">
                    {t('Reglas para determinar la inactividad y proceder con la fragmentación de llaves.', 'Rules to determine inactivity and proceed with the key sharing.')}
                </p>

                <div className="row g-4">
                    <div className="col-md-6">
                        <label className="form-label">{t('Umbral de Inactividad Total', 'Total Inactivity Threshold')}</label>
                        <select
                            className="form-select shadow-none"
                            value={umbral}
                            onChange={(e) => setUmbral(Number(e.target.value))}
                            disabled={loadingProtocolo}
                        >
                            {UMBRAL_OPCIONES.map((dias) => (
                                <option key={dias} value={dias}>
                                    {dias} {t('Días', 'Days')}{dias === DEFAULT_UMBRAL ? t(' (Recomendado)', ' (Recommended)') : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="col-md-6">
                        <label className="form-label">{t('Periodo de Gracia Crítico', 'Critical Grace Period')}</label>
                        <select
                            className="form-select shadow-none"
                            value={gracia}
                            onChange={(e) => setGracia(Number(e.target.value))}
                            disabled={loadingProtocolo}
                        >
                            {GRACIA_OPCIONES.map((dias) => (
                                <option key={dias} value={dias}>
                                    {dias} {t('Días', 'Days')}
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
                        {savingUmbral ? t('Actualizando...', 'Updating...') : t('Actualizar Umbrales', 'Update Thresholds')}
                    </button>
                </div>
                <p className="section-desc mt-3 mb-0">
                    {t('Iniciar sesión en el sistema cuenta como señal de vida y reinicia el contador de inactividad automáticamente.', 'Signing in to the system counts as a sign of life and automatically resets the inactivity counter.')}
                </p>
            </section>

            {/* SECCIÓN 2: CANALES */}
            <section className="config-section">
                <div className="section-title">
                    <i className="fas fa-satellite-dish"></i> {t('Canales de Comunicación', 'Communication Channels')}
                </div>
                <p className="section-desc">
                    {t('Vincula servicios para recibir alertas y realizar check-ins automáticos.', 'Link services to receive alerts and perform automatic check-ins.')}
                </p>

                {/* Telegram */}
                <div className="integration-box">
                    <div className="d-flex align-items-center">
                        <div className={`integration-status-dot ${telegramVinculado ? 'linked' : 'unlinked'}`}></div>
                        <div>
                            <div className="fw-bold small">Telegram Bot</div>
                            <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                {telegramVinculado ? t('Vinculado', 'Linked') : t('No configurado', 'Not set up')}
                            </div>
                        </div>
                    </div>
                    {telegramVinculado ? (
                        <button
                            className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                            onClick={handleDesvincularTelegram}
                            disabled={telegramLoading}
                        >
                            {telegramLoading ? t('Desvinculando...', 'Unlinking...') : t('Desvincular', 'Unlink')}
                        </button>
                    ) : (
                        <button
                            className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                            onClick={handleVincularTelegram}
                            disabled={telegramLoading}
                        >
                            {telegramLoading ? t('Generando...', 'Generating...') : t('Vincular', 'Link')}
                        </button>
                    )}
                </div>

                {telegramLinkInfo && !telegramVinculado && (
                    <div className="p-3 rounded-4 bg-light small mb-3">
                        <p className="mb-2">
                            {t('Abre este enlace en Telegram para completar la vinculación', 'Open this link in Telegram to finish linking')}
                            {telegramSegundosRestantes > 0 && (
                                <> ({t('expira en', 'expires in')} {telegramSegundosRestantes}s)</>
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
                                {t('Abrir Telegram', 'Open Telegram')} <i className="fab fa-telegram ms-1"></i>
                            </a>
                            <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary rounded-pill"
                                onClick={handleRefrescarEstadoTelegram}
                                disabled={telegramLoading}
                            >
                                {t('Ya vinculé, actualizar', "I've linked it, refresh")}
                            </button>
                        </div>
                    </div>
                )}

                {/* Correo Alternativo */}
                <div className="integration-box">
                    <div className="d-flex align-items-center">
                        <div className={`integration-status-dot ${correoVinculado ? 'linked' : 'unlinked'}`}></div>
                        <div>
                            <div className="fw-bold">{t('Correo Alternativo', 'Alternate Email')}</div>
                            <div className="small text-muted">
                                {correoVinculado ? user?.correo_sec : t('No configurado', 'Not set up')}
                            </div>
                        </div>
                    </div>
                    {correoVinculado ? (
                        <button
                            className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                            onClick={handleDesvincularCorreo}
                            disabled={correoLoading}
                        >
                            {correoLoading ? t('Desvinculando...', 'Unlinking...') : t('Desvincular', 'Unlink')}
                        </button>
                    ) : (
                        <button
                            className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                            onClick={() => setCorreoFormAbierto((prev) => !prev)}
                        >
                            {t('Vincular', 'Link')}
                        </button>
                    )}
                </div>

                {correoSolicitado && !correoVinculado && (
                    <div className="p-3 rounded-4 bg-light small mb-3 text-muted">
                        <i className="fas fa-info-circle me-1 text-primary"></i>
                        {getLang() === 'es' ? (
                            <>
                                Revisa la bandeja de entrada de <strong>{correoSolicitado}</strong> para confirmar la
                                vinculación. El enlace expira en 30 minutos.
                            </>
                        ) : (
                            <>
                                Check the inbox of <strong>{correoSolicitado}</strong> to confirm the link. The link
                                expires in 30 minutes.
                            </>
                        )}
                    </div>
                )}

                {correoFormAbierto && !correoVinculado && (
                    <form onSubmit={handleSolicitarCorreoSecundario} className="d-flex gap-2 flex-wrap mb-3">
                        <input
                            type="email"
                            className="form-control shadow-none"
                            style={{ maxWidth: 280 }}
                            placeholder={t('correo.alterno@ejemplo.com', 'alternate.email@example.com')}
                            value={correoNuevo}
                            onChange={(e) => setCorreoNuevo(e.target.value)}
                            required
                        />
                        <button type="submit" className="btn btn-ipn btn-sm" disabled={correoLoading}>
                            {correoLoading ? t('Enviando...', 'Sending...') : t('Enviar confirmación', 'Send confirmation')}
                        </button>
                    </form>
                )}
            </section>

            {/* SECCIÓN 3: PERFIL DE USUARIO */}
            <section className="config-section">
                <div className="section-title">
                    <i className="fas fa-user-circle"></i> {t('Perfil de Usuario', 'User Profile')}
                </div>
                <p className="section-desc">{t('Información básica del propietario de la cuenta maestra.', 'Basic information about the master account owner.')}</p>
                <div className="d-flex align-items-center justify-content-between p-3 border rounded-4 bg-light bg-opacity-25 flex-wrap gap-3">
                    <div className="d-flex align-items-center">
                        <img
                            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
                                user?.nombre ?? user?.username ?? t('Usuario', 'User')
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
                        {t('Editar Perfil', 'Edit Profile')} <i className="fas fa-user-edit ms-2"></i>
                    </button>
                </div>
            </section>

            {/* SECCIÓN 4: ZONA CRÍTICA */}
            <section className="config-section config-section-danger">
                <div className="section-title text-danger">
                    <i className="fas fa-exclamation-triangle"></i> {t('Zona Crítica', 'Danger Zone')}
                </div>
                <p className="section-desc">{t('Acciones irreversibles sobre el patrimonio digital.', 'Irreversible actions on your digital estate.')}</p>
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                    <div>
                        <div className="fw-bold">{t('Eliminar Patrimonio Permanente', 'Permanently Delete Estate')}</div>
                        {getLang() === 'es' ? (
                            <div className="text-muted small">
                                La cuenta entra en una cola de <strong>30 días</strong>. Si no vuelves a
                                iniciar sesión y cancelar en ese plazo, se borran todas tus bóvedas,
                                archivos y custodios, y tus datos personales se borran.
                            </div>
                        ) : (
                            <div className="text-muted small">
                                The account enters a <strong>30-day</strong> queue. If you don't sign in again and
                                cancel within that time, all your vaults, files and custodians are deleted, along
                                with your personal data.
                            </div>
                        )}
                    </div>
                    <button
                        className="btn btn-danger rounded-pill px-4"
                        onClick={() => setDeleteOpen(true)}
                    >
                        {t('Programar eliminación', 'Schedule deletion')}
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
                                <h4 className="fw-bold text-center mb-1">{t('Programar eliminación', 'Schedule deletion')}</h4>
                                {getLang() === 'es' ? (
                                    <p className="text-muted small text-center mb-4">
                                        Tu cuenta entrará en una cola de <strong>30 días</strong> y quedará
                                        bloqueada. Si inicias sesión y cancelas antes de que venza el plazo,
                                        no se pierde nada. Si no, se borran <strong>todas tus bóvedas</strong>,
                                        archivos y custodios, y tus datos personales se
                                        borran. Esto también <strong>pausa la recuperación por custodios</strong>.
                                    </p>
                                ) : (
                                    <p className="text-muted small text-center mb-4">
                                        Your account will enter a <strong>30-day</strong> queue and be locked. If you
                                        sign in and cancel before the deadline, nothing is lost. Otherwise{' '}
                                        <strong>all your vaults</strong>, files and custodians are deleted, along with
                                        your personal data. This also <strong>pauses recovery by custodians</strong>.
                                    </p>
                                )}

                                {deleteErr && (
                                    <div className="alert alert-danger py-2 small">{deleteErr}</div>
                                )}

                                <label className="form-label-b d-block mb-1">{t('Contraseña de la cuenta', 'Account password')}</label>
                                <input
                                    type="password"
                                    className="form-control shadow-none mb-3"
                                    autoComplete="current-password"
                                    value={deletePassword}
                                    onChange={(e) => setDeletePassword(e.target.value)}
                                    disabled={deleting}
                                />

                                <label className="form-label-b d-block mb-1">
                                    {t('Escribe', 'Type')} <code>{CONFIRM_WORD}</code> {t('para confirmar', 'to confirm')}
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
                                        {t('Cancelar', 'Cancel')}
                                    </button>
                                    <button
                                        className="btn btn-danger w-100 rounded-pill"
                                        onClick={handleEliminarCuenta}
                                        disabled={!puedeEliminar || deleting}
                                    >
                                        {deleting ? t('Programando…', 'Scheduling…') : t('Programar eliminación', 'Schedule deletion')}
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
