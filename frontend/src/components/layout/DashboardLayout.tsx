import { useNavigate, Link } from 'react-router-dom';
import { useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../store/AuthContext';
import { getTheme, toggleTheme } from '../../theme';
import { purgeAll } from '../../crypto/sensitiveMemory';
import AvisoPlan from './AvisoPlan';
import './DashboardLayout.css';
import KleimosLogo from '../brand/KleimosLogo';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Única fuente de verdad del sidebar. Se agrega/activa una entrada aquí
// en cuanto su módulo tenga backend + pantalla propia; mientras tanto queda
// como label deshabilitado ("Pronto").
// ---------------------------------------------------------------------------

export type NavKey =
    | 'dashboard'
    | 'bovedas'
    | 'checkins'
    | 'suscripcion'
    | 'custodios'
    | 'configuracion'
    | 'admin-propietarios'
    | 'admin-notificaciones'
    | 'admin-auditoria';

interface NavItem {
    key: NavKey;
    label: string;
    icon: string;
    enabled: boolean;
    path?: string;
}

const NAV_ITEMS: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', icon: 'fa-th-large', enabled: true, path: '/dashboard' },
    { key: 'bovedas', label: 'Mis Bóvedas', icon: 'fa-vault', enabled: true, path: '/bovedas' },
    { key: 'checkins', label: 'Historial de Check-ins', icon: 'fa-calendar-check', enabled: true, path: '/historial-checkins' },
    { key: 'suscripcion', label: 'Suscripción', icon: 'fa-credit-card', enabled: true, path: '/suscripcion' },
    { key: 'custodios', label: 'Custodios', icon: 'fa-users-cog', enabled: true, path: '/custodios' },
];

// Nav del panel admin: opera sobre cuentas de propietarios, no tiene bóvedas
// ni custodios ni suscripción propios.
const ADMIN_NAV_ITEMS: NavItem[] = [
    { key: 'admin-propietarios', label: 'Propietarios', icon: 'fa-users', enabled: true, path: '/admin' },
    { key: 'admin-notificaciones', label: 'Notificaciones', icon: 'fa-paper-plane', enabled: true, path: '/admin/notificaciones' },
    { key: 'admin-auditoria', label: 'Auditoría', icon: 'fa-clipboard-list', enabled: true, path: '/admin/auditoria' },
];

const CONFIG_ITEM: NavItem = { key: 'configuracion', label: 'Configuración', icon: 'fa-gear', enabled: true, path: '/configuracion' };

interface DashboardLayoutProps {
    /** Qué entrada del sidebar se resalta como activa en esta página. */
    activeItem: NavKey;
    /** Texto pequeño del topbar (ej. "Área de trabajo", "Gestión de Identidad"). */
    topBarLabel: string;
    /** Si se define, muestra una flecha de "volver" en el topbar hacia esa ruta. */
    backTo?: string;
    /** 'admin' cambia el sidebar por el del panel admin y oculta "Configuración"
     * (protocolo de vida: no aplica a una cuenta admin, que no es propietaria). */
    variant?: 'propietario' | 'admin';
    children: ReactNode;
}

export default function DashboardLayout({ activeItem, topBarLabel, backTo, variant = 'propietario', children }: DashboardLayoutProps) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    // Barra superior: nombre de pila + primer apellido (paterno).
    const nombreCompleto =
        [user?.nombre, user?.paterno].filter(Boolean).join(' ') || user?.username || 'Usuario';
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [theme, setTheme] = useState(getTheme());
    const [loggingOut, setLoggingOut] = useState(false);
    const [cleanup, setCleanup] = useState({ pct: 0, text: '' });
    const logoutRunning = useRef(false);

    // Cada paso hace algo REAL:
    //  1) purgeAll()  -> pone a cero en RAM la DEK y los fragmentos que sigan vivos
    //  2) logout()    -> elimina el JWT de localStorage y limpia el estado de sesión
    //  3) location.assign('/') -> recarga completa: descarta el heap JS y la
    //     instancia WASM del motor Shamir (borrado "duro" de toda la memoria).
    const handleLogout = async () => {
        if (logoutRunning.current) return;
        logoutRunning.current = true;
        setMobileMenuOpen(false);
        setCleanup({ pct: 8, text: 'Iniciando cierre seguro…' });
        setLoggingOut(true);

        await sleep(150);
        const borradas = purgeAll();
        setCleanup({
            pct: 40,
            text: borradas > 0
                ? `Borrando ${borradas} llave(s) criptográfica(s) de la memoria…`
                : 'Verificando que no queden llaves en memoria…',
        });

        await sleep(650);
        logout(); // quita access_token de localStorage + user=null
        setCleanup({ pct: 75, text: 'Cerrando la sesión…' });

        await sleep(550);
        setCleanup({ pct: 100, text: 'Reiniciando la aplicación…' });

        await sleep(450);
        window.location.assign('/'); // recarga completa: destruye heap JS + WASM
    };

    // Contenido del menú compartido entre el sidebar de escritorio y el
    // panel deslizable de móvil, para no duplicar la lista de opciones.
    const items = variant === 'admin' ? ADMIN_NAV_ITEMS : NAV_ITEMS;
    const navList = (
        <ul className="nav flex-column">
            {items.map((item) => (
                <li className="nav-item" key={item.key}>
                    {item.enabled ? (
                        <Link
                            className={`nav-link ${activeItem === item.key ? 'active' : ''}`}
                            to={item.path!}
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            <i className={`fas ${item.icon} me-2`}></i> {item.label}
                        </Link>
                    ) : (
                        <span className="nav-link is-disabled" title="Próximamente">
                            <i className={`fas ${item.icon} me-2`}></i> {item.label}
                            <span className="soon-badge">Pronto</span>
                        </span>
                    )}
                </li>
            ))}

            <hr className="my-4 opacity-50" />

            {variant !== 'admin' && (
                <li className="nav-item">
                    <Link
                        className={`nav-link ${activeItem === 'configuracion' ? 'active' : ''}`}
                        to={CONFIG_ITEM.path!}
                        onClick={() => setMobileMenuOpen(false)}
                    >
                        <i className={`fas ${CONFIG_ITEM.icon} me-2`}></i> {CONFIG_ITEM.label}
                    </Link>
                </li>
            )}
            <li className="nav-item">
                <a
                    className="nav-link text-danger"
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        setMobileMenuOpen(false);
                        handleLogout();
                    }}
                >
                    <i className="fas fa-power-off me-2"></i> Cerrar Sesión
                </a>
            </li>
        </ul>
    );

    const brandHeader = (
        <div className="mb-5 px-2">
            <KleimosLogo tamano="sm" />
        </div>
    );

    return (
        <div className="dashboard-shell">
            <div className="d-flex align-items-start">
                {/* Sidebar — solo escritorio */}
                <nav className="sidebar d-none d-lg-block" style={{ width: 280 }}>
                    {brandHeader}
                    {navList}
                </nav>

                {/* Content Area */}
                <div className="flex-grow-1">
                    <header className="top-bar d-flex justify-content-between align-items-center">
                        <div className="d-flex align-items-center">
                            {backTo && (
                                <Link to={backTo} className="btn btn-light btn-sm rounded-pill me-3">
                                    <i className="fas fa-arrow-left"></i>
                                </Link>
                            )}
                            <span className="text-muted small fw-bold text-uppercase">{topBarLabel}</span>
                        </div>
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
                        <div
                            className="user-profile is-clickable d-flex align-items-center"
                            onClick={() => navigate('/perfil')}
                            title="Editar perfil"
                        >
                            <div className="text-end me-3">
                                <p className="m-0 small fw-bold">{nombreCompleto}</p>
                                {user?.suscripcion_activa && (
                                    <p className="m-0 text-muted" style={{ fontSize: '0.7rem' }}>
                                        Plan {user.suscripcion_activa.nombre}
                                    </p>
                                )}
                            </div>
                            <img
                                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
                                    nombreCompleto
                                )}&background=003366&color=fff`}
                                className="rounded-circle shadow-sm"
                                width={40}
                                height={40}
                                alt="Perfil"
                            />
                        </div>
                        </div>
                    </header>

                    <main className="main-content animate__animated animate__fadeIn">
                        <AvisoPlan suscripcion={user?.suscripcion_activa} />
                        {children}
                    </main>
                </div>
            </div>

            {/* Burbuja flotante — solo móvil/tablet, abre el menú lateral */}
            <button
                type="button"
                className="mobile-menu-fab d-lg-none"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
            >
                <i className={`fas ${mobileMenuOpen ? 'fa-times' : 'fa-bars'}`}></i>
            </button>

            {/* Panel deslizable + fondo oscuro — solo cuando está abierto */}
            {mobileMenuOpen && (
                <>
                    <div className="mobile-menu-backdrop d-lg-none" onClick={() => setMobileMenuOpen(false)}></div>
                    <nav className="mobile-menu-drawer d-lg-none">
                        {brandHeader}
                        {navList}
                    </nav>
                </>
            )}

            {/* Modal de cierre de sesión seguro (mock/dashboard.html) */}
            {loggingOut && (
                <div className="modal fade show d-block logout-modal" tabIndex={-1} style={{ background: 'rgba(15,23,42,0.6)' }}>
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content shadow-lg">
                            <div className="modal-header-gradient"></div>
                            <div className="modal-body text-center p-5">
                                <div className="logout-anim mb-4">
                                    <div className="spinner-border text-primary" style={{ width: '4rem', height: '4rem', borderWidth: '0.3em' }} role="status"></div>
                                    <i className="fas fa-broom fa-2x animate__animated animate__swing animate__infinite logout-broom"></i>
                                </div>
                                <h4 className="fw-bold mb-2">Cerrando Sesión Segura</h4>
                                <p className="text-muted small mb-0">{cleanup.text}</p>
                                <div className="progress mt-4" style={{ height: 6, borderRadius: 10 }}>
                                    <div
                                        className="progress-bar progress-bar-striped progress-bar-animated"
                                        role="progressbar"
                                        style={{ width: `${cleanup.pct}%`, background: 'var(--ipn-maroon)' }}
                                    ></div>
                                </div>
                                <p className="mt-3 logout-proto">Kleimos Legacy</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
