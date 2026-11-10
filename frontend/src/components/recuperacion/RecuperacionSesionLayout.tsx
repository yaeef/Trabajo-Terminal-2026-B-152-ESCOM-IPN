import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getTheme, toggleTheme } from '../../theme';
import { useRecuperacionSession } from '../../store/RecuperacionSessionContext';
import type { SesionEstadoResponse } from '../../types/recuperacion.types';
import '../layout/DashboardLayout.css';
import './RecuperacionSesionLayout.css';
import KleimosLogo from '../brand/KleimosLogo';

function fmtFecha(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

interface RecuperacionSesionLayoutProps {
    pid: string;
    bovedaNombre?: string;
    rol: 'bp' | 'custodio';
    activeKey: 'estado' | 'activos';
    sesion: SesionEstadoResponse | null;
    nombreMostrado?: string;
    children: ReactNode;
}

/**
 * Cascarón compartido de las páginas "dentro de sesión" (bp_dashboard.html /
 * dashboard_custodio.html / boveda_desbloqueada.html del mockup). Reutiliza
 * las clases globales del dashboard autenticado (.dashboard-shell/.sidebar/
 * .top-bar/.nav-link) para que se vea consistente con el resto de la app,
 * pero es una navegación propia — quien la usa no tiene cuenta.
 */
export default function RecuperacionSesionLayout({
    pid,
    bovedaNombre,
    rol,
    activeKey,
    sesion,
    nombreMostrado,
    children,
}: RecuperacionSesionLayoutProps) {
    const navigate = useNavigate();
    const { bp, clear } = useRecuperacionSession();
    const [theme, setTheme] = useState(getTheme());
    const activosHabilitado = !!bp?.dek;

    const estadoPath = rol === 'bp' ? `/recuperacion/${pid}/bp` : `/recuperacion/${pid}/custodio`;

    const salir = () => {
        clear();
        navigate('/recuperacion');
    };

    return (
        <div className="dashboard-shell recuperacion-sesion-shell">
            <div className="d-flex align-items-start">
                <nav className="sidebar d-none d-lg-block" style={{ width: 280 }}>
                    <div className="mb-4 px-2">
                        <KleimosLogo tamano="sm" />
                        <small className="text-muted fw-bold d-block mt-2">RECUPERACIÓN</small>
                    </div>

                    {sesion?.expira_en && (
                        <div className="recuperacion-sesion-timer mb-4">
                            <small className="text-muted fw-bold text-uppercase d-block mb-1" style={{ fontSize: '0.6rem' }}>
                                Sesión vence
                            </small>
                            <span className="recuperacion-sesion-timer-val">{fmtFecha(sesion.expira_en)}</span>
                        </div>
                    )}

                    <ul className="nav flex-column">
                        <li className="nav-item">
                            <Link className={`nav-link ${activeKey === 'estado' ? 'active' : ''}`} to={estadoPath}>
                                <i className="fas fa-th-large me-2"></i> Estado General
                            </Link>
                        </li>
                        {rol === 'bp' && (
                            <li className="nav-item">
                                {activosHabilitado ? (
                                    <Link
                                        className={`nav-link ${activeKey === 'activos' ? 'active' : ''}`}
                                        to={`/recuperacion/${pid}/activos`}
                                    >
                                        <i className="fas fa-boxes-stacked me-2"></i> Activos
                                    </Link>
                                ) : (
                                    <span
                                        className="nav-link is-disabled"
                                        title="Reconstruye la llave maestra en Estado General para desbloquear esta sección"
                                    >
                                        <i className="fas fa-lock me-2"></i> Activos
                                    </span>
                                )}
                            </li>
                        )}
                        <hr className="my-4 opacity-50" />
                        <li className="nav-item">
                            <a
                                className="nav-link text-danger"
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    salir();
                                }}
                            >
                                <i className="fas fa-power-off me-2"></i>{' '}
                                {rol === 'bp' ? 'Cerrar Sesión' : 'Abandonar Sesión'}
                            </a>
                        </li>
                    </ul>
                </nav>

                <div className="flex-grow-1">
                    <header className="top-bar d-flex justify-content-between align-items-center">
                        <span className="text-muted small fw-bold text-uppercase">
                            Bóveda: {bovedaNombre || pid}
                        </span>
                        <div className="d-flex align-items-center gap-2">
                            <button
                                type="button"
                                className="theme-toggle"
                                onClick={() => setTheme(toggleTheme())}
                                title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                                aria-label="Cambiar tema"
                            >
                                <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
                            </button>
                            <div className="text-end">
                                <p className="m-0 small fw-bold">{nombreMostrado || 'Sin nombre'}</p>
                                <p
                                    className="m-0"
                                    style={{ fontSize: '0.7rem', color: rol === 'bp' ? 'var(--ipn-maroon)' : 'var(--success-green, #2ecc71)' }}
                                >
                                    <i className={`fas ${rol === 'bp' ? 'fa-crown' : 'fa-circle'} me-1`} style={{ fontSize: '0.6rem' }} />
                                    {rol === 'bp' ? 'Beneficiario Principal' : 'Custodio'}
                                </p>
                            </div>
                        </div>
                    </header>

                    <main className="main-content animate__animated animate__fadeIn">{children}</main>
                </div>
            </div>
        </div>
    );
}
