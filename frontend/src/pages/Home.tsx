import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTheme, toggleTheme } from '../theme';
import './Home.css';
import KleimosLogo from '../components/brand/KleimosLogo';

// ---------------------------------------------------------------------------
// Datos estáticos de las secciones
// ---------------------------------------------------------------------------

const CONCEPTS = [
    {
        icon: 'fa-puzzle-piece',
        title: '1. Los Fragmentos',
        paragraphs: [
            'Imagina que tu llave de acceso a tu patrimonio es un mapa del tesoro. En lugar de darle el mapa a una persona, lo dividimos en piezas llamadas fragmentos.',
            'Tener un solo fragmento no sirve de nada; no revela ninguna pista sobre la ubicación del tesoro.',
        ],
    },
    {
        icon: 'fa-users-cog',
        title: '2. El Umbral (k)',
        paragraphs: [
            'Aquí está la magia: no necesitas todas las piezas para reconstruir el mapa. Tú decides cuántas son necesarias.',
            'Si repartes 5 fragmentos y pones un umbral de 3, el secreto se revelará en cuanto 3 de tus familiares, o amigos, se reúnan.',
        ],
    },
    {
        icon: 'fa-lock',
        title: '3. Seguridad Total',
        paragraphs: [
            'Matemáticamente, es imposible adivinar tu llave de acceso si te falta aunque sea una sola pieza del umbral.',
            'Tus llaves están resguardadas por un esquema de Secreto Compartido.',
        ],
    },
];

const CHECKLIST = [
    { title: 'Cero Conocimiento:', text: 'Nunca vemos tus archivos ni conocemos tus llaves.' },
    { title: 'Descentralizado:', text: 'Tus familiares guardan las llaves, no nosotros.' },
    { title: 'Validación VSS:', text: 'Verificamos que nadie te dé una pieza falsa.' },
];

const ASSET_TYPES = [
    {
        icon: 'fa-key',
        title: 'Contraseñas',
        text: 'Todos tus accesos y cuentas importantes, cifrados en un solo lugar.',
    },
    {
        icon: 'fa-wallet',
        title: 'Seed Phrases',
        text: 'Las frases de recuperación de tus wallets cripto, sin exponerlas nunca.',
    },
    {
        icon: 'fa-file-contract',
        title: 'Documentos',
        text: 'Testamentos, escrituras, pólizas o cualquier archivo sensible.',
    },
    {
        icon: 'fa-id-badge',
        title: 'Credenciales',
        text: 'Accesos a plataformas, licencias digitales y cuentas corporativas.',
    },
];

const BEFORE_ITEMS = [
    'Contraseñas y seed phrases dispersas en notas, correos o la memoria de una sola persona.',
    'Si te pasa algo, tu familia no sabe ni por dónde empezar a buscar tus accesos.',
    'Un solo punto de fallo: si pierdes ese papel o USB, se pierde todo para siempre.',
    'Dependes de que un tercero (banco, plataforma) decida qué hacer con tus claves.',
];

const AFTER_ITEMS = [
    'Todo cifrado en un solo lugar, con una llave que solo tú controlas.',
    'Un protocolo automático detecta tu inactividad y activa la sucesión.',
    'Ningún custodio, por sí solo, puede acceder a tu bóveda (Shamir, k de n).',
    'Tus seres queridos reciben exactamente lo que definiste, sin intermediarios.',
];

const FAQ_ITEMS = [
    {
        question: '¿Ustedes pueden ver mis contraseñas o archivos?',
        answer: 'No. Todo se cifra en tu navegador antes de subirse. Nosotros solo guardamos compromisos criptográficos (Feldman VSS) para validar fragmentos, nunca la llave ni tus activos en claro.',
    },
    {
        question: '¿Un solo custodio puede acceder a mi bóveda?',
        answer: 'No. Usamos Shamir Secret Sharing: se necesita un mínimo de k fragmentos (que tú defines) para reconstruir la llave. Ningún custodio individual tiene acceso por sí solo.',
    },
    {
        question: '¿Qué pasa si un custodio pierde su fragmento o no responde?',
        answer: 'Por eso se recomienda repartir más fragmentos (n) de los que se necesitan (k). Mientras sigan disponibles al menos k fragmentos válidos, la recuperación sigue siendo posible.',
    },
    {
        question: '¿Qué pasa si no respondo las pruebas de vida pero sigo bien?',
        answer: 'Existe un periodo de gracia configurable antes de que se active cualquier alerta o proceso de recuperación, para evitar falsas alarmas.',
    },
    {
        question: '¿Cuánto tiempo tienen mis beneficiarios para completar la recuperación?',
        answer: 'Una vez confirmada la inactividad, hay un plazo único e improrrogable de 12 meses. Si no se completa en ese periodo, los archivos se eliminan.',
    },
];

// ---------------------------------------------------------------------------
// Animación Shamir (reparto / reconstrucción de fragmentos entre custodios)
// ---------------------------------------------------------------------------

type Step = 'idle' | 'split' | 'quorum' | 'success';

const POSITIONS = [
    { x: 0, y: -150 },
    { x: 150, y: -30 },
    { x: 90, y: 130 },
    { x: -90, y: 130 },
    { x: -150, y: -30 },
];

// Índices de los custodios que participan en el quórum de recuperación (3 de 5)
const WINNERS = [0, 2, 4];

const STEP_ORDER: Step[] = ['idle', 'split', 'quorum', 'success'];
const STEP_DURATION_MS: Record<Step, number> = {
    idle: 2000,
    split: 3500,
    quorum: 2500,
    success: 4500,
};

const STEP_LABEL: Record<Step, string> = {
    idle: 'Protegiendo acceso...',
    split: 'Dividiendo en 5 piezas...',
    quorum: 'Recuperación: 3 personas se reúnen...',
    success: '¡Acceso Restaurado!',
};

function ShamirAnimation() {
    const [step, setStep] = useState<Step>('idle');

    // Ciclo infinito con setTimeout encadenado + limpieza al desmontar
    // (evita fugas de timers en StrictMode / al navegar fuera de la página).
    useEffect(() => {
        let cancelled = false;
        let timeoutId: ReturnType<typeof setTimeout>;

        const advance = (current: Step) => {
            timeoutId = setTimeout(() => {
                if (cancelled) return;
                const nextIndex = (STEP_ORDER.indexOf(current) + 1) % STEP_ORDER.length;
                const next = STEP_ORDER[nextIndex];
                setStep(next);
                advance(next);
            }, STEP_DURATION_MS[current]);
        };

        advance('idle');

        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
    }, []);

    const coreVisible = step === 'idle' || step === 'success';
    const nodesActive = step !== 'idle';

    return (
        <div className="anim-box">
            <div className="anim-label">{STEP_LABEL[step]}</div>

            <div
                className="main-secret"
                style={{
                    transform: coreVisible ? (step === 'success' ? 'scale(1.2)' : 'scale(1)') : 'scale(0)',
                    opacity: coreVisible ? 1 : 0,
                }}
            >
                {step === 'success' ? (
                    <i className="fas fa-shield-alt" style={{ color: '#2ecc71' }}></i>
                ) : (
                    <i className="fas fa-key"></i>
                )}
            </div>

            {POSITIONS.map((_, i) => {
                const isWinner = WINNERS.includes(i);
                const win = nodesActive && isWinner && (step === 'quorum' || step === 'success');
                const active = nodesActive && !win;
                const className = [
                    'custodian-circle',
                    `c-${i + 1}`,
                    active ? 'circle-active' : '',
                    win ? 'circle-win' : '',
                ]
                    .filter(Boolean)
                    .join(' ');
                return (
                    <div className={className} key={`node-${i}`}>
                        <i className="fas fa-user-shield"></i>
                    </div>
                );
            })}

            {POSITIONS.map((pos, i) => {
                const isWinner = WINNERS.includes(i);
                let opacity = 0;
                let transform = 'translate(0, 0)';
                let background = 'var(--sim-light-purple)';

                if (step === 'split') {
                    opacity = 1;
                    transform = `translate(${pos.x}px, ${pos.y}px)`;
                } else if (step === 'quorum') {
                    opacity = 1;
                    if (isWinner) {
                        transform = 'translate(0, 0)';
                        background = '#2ecc71';
                    } else {
                        transform = `translate(${pos.x}px, ${pos.y}px)`;
                    }
                }
                // en 'success' todos los fragmentos vuelven a opacity 0

                return (
                    <div
                        className="key-fragment"
                        key={`frag-${i}`}
                        style={{
                            opacity,
                            transform,
                            background,
                            boxShadow: `0 0 10px ${background}`,
                        }}
                    ></div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Acordeón de preguntas frecuentes (implementación propia, sin JS de Bootstrap)
// ---------------------------------------------------------------------------

function FaqAccordion() {
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    return (
        <div className="faq-accordion">
            {FAQ_ITEMS.map((item, i) => {
                const isOpen = openIndex === i;
                return (
                    <div className={`faq-item ${isOpen ? 'is-open' : ''}`} key={item.question}>
                        <button
                            type="button"
                            className="faq-question"
                            onClick={() => setOpenIndex(isOpen ? null : i)}
                            aria-expanded={isOpen}
                        >
                            <span>{item.question}</span>
                            <i className="fas fa-chevron-down faq-chevron"></i>
                        </button>
                        {isOpen && <p className="faq-answer">{item.answer}</p>}
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Página Home
// ---------------------------------------------------------------------------

export default function Home() {
    const [theme, setTheme] = useState(getTheme());
    const [menuOpen, setMenuOpen] = useState(false);
    const closeMenu = () => setMenuOpen(false);

    const themeBtn = (
        <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(toggleTheme())}
            title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            aria-label="Cambiar tema"
        >
            <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
    );

    return (
        <div className="home-page">
            {/* Navbar */}
            <nav className="navbar navbar-expand-lg navbar-clean sticky-top">
                <div className="container">
                    <a className="navbar-brand" href="#top" aria-label="Kleimos Legacy, inicio">
                        <KleimosLogo tamano="sm" />
                    </a>

                    {/* Hamburguesa — solo móvil/tablet */}
                    <button
                        type="button"
                        className="home-nav-toggler d-lg-none"
                        onClick={() => setMenuOpen((o) => !o)}
                        aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
                        aria-expanded={menuOpen}
                    >
                        <i className={`fas ${menuOpen ? 'fa-times' : 'fa-bars'}`}></i>
                    </button>

                    {/* Acciones en línea — solo escritorio */}
                    <div className="ms-auto d-none d-lg-flex gap-2 align-items-center">
                        <a href="#conceptos" className="home-nav-link">Conceptos</a>
                        <a href="#proceso" className="home-nav-link">Proceso</a>
                        <a href="#faq" className="home-nav-link">FAQ</a>
                        {themeBtn}
                        <Link to="/login" className="btn btn-outline-secondary rounded-pill px-4">
                            Ingresar
                        </Link>
                        <Link to="/recuperacion" className="btn-ipn">
                            Comenzar Recuperación
                        </Link>
                    </div>
                </div>

                {/* Panel colapsable — solo móvil, al abrir */}
                {menuOpen && (
                    <div className="home-nav-menu d-lg-none">
                        <a href="#conceptos" onClick={closeMenu}>Conceptos</a>
                        <a href="#proceso" onClick={closeMenu}>Proceso</a>
                        <a href="#faq" onClick={closeMenu}>FAQ</a>
                        <div className="d-flex align-items-center gap-2 mt-2">
                            {themeBtn}
                            <Link to="/login" className="btn btn-outline-secondary rounded-pill flex-grow-1" onClick={closeMenu}>
                                Ingresar
                            </Link>
                        </div>
                        <Link to="/recuperacion" className="btn-ipn w-100 text-center mt-2" onClick={closeMenu}>
                            Comenzar Recuperación
                        </Link>
                    </div>
                )}
            </nav>

            {/* Hero */}
            <div className="parallax-section shadow-lg mb-5" id="top">
                <div className="parallax-overlay">
                    <div className="container">
                        <div className="home-hero-card text-white text-center animate__animated animate__fadeInDown">
                            <div className="d-none d-md-flex justify-content-center">
                                <KleimosLogo tamano="lg" tono="oscuro" />
                            </div>
                            <div className="d-flex d-md-none justify-content-center">
                                <KleimosLogo tamano="md" tono="oscuro" />
                            </div>

                            <h1 className="home-hero-titulo">Protege tu patrimonio digital</h1>
                            <p className="home-hero-sub">
                                Tus archivos, cifrados y repartidos entre personas de confianza, llegan a quien tú elijas
                                si algo te pasa.
                            </p>

                            <a href="#conceptos" className="btn btn-lg rounded-pill fw-bold px-5 shadow-lg home-hero-btn">
                                <i className="fas fa-microchip me-2"></i>Empezar
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            {/* Antes / Después: riesgo sin Kleimos vs. protegido con Kleimos */}
            <section className="section-band section-band--white">
            <div className="container">
                <div className="text-center mb-5">
                    <h2 className="fw-bold">Tu patrimonio digital, hoy vs. con Kleimos</h2>
                    <div
                        className="mx-auto my-3"
                        style={{ width: '80px', height: '4px', background: 'var(--ipn-maroon)' }}
                    ></div>
                </div>

                <div className="row g-4">
                    <div className="col-md-6">
                        <div className="card risk-card risk-card--before p-4 h-100">
                            <span className="risk-badge risk-badge--before">
                                <i className="fas fa-triangle-exclamation me-2"></i>Hoy, sin protección
                            </span>
                            <ul className="list-unstyled mt-4 mb-0">
                                {BEFORE_ITEMS.map((text) => (
                                    <li className="mb-3 d-flex" key={text}>
                                        <i className="fas fa-circle-xmark text-danger me-2 mt-1"></i>
                                        <span className="text-muted">{text}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                    <div className="col-md-6">
                        <div className="card risk-card risk-card--after p-4 h-100">
                            <span className="risk-badge risk-badge--after">
                                <i className="fas fa-shield-heart me-2"></i>Con Kleimos
                            </span>
                            <ul className="list-unstyled mt-4 mb-0">
                                {AFTER_ITEMS.map((text) => (
                                    <li className="mb-3 d-flex" key={text}>
                                        <i className="fas fa-circle-check text-success me-2 mt-1"></i>
                                        <span className="text-muted">{text}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
            </section>

            {/* ¿Qué puedes guardar en tu bóveda? */}
            <section className="section-band section-band--tint">
            <div className="container">
                <div className="text-center mb-5">
                    <h2 className="fw-bold">¿Qué puedes guardar en tu bóveda?</h2>
                    <div
                        className="mx-auto my-3"
                        style={{ width: '80px', height: '4px', background: 'var(--ipn-maroon)' }}
                    ></div>
                </div>

                <div className="row g-4">
                    {ASSET_TYPES.map((a) => (
                        <div className="col-6 col-lg-3" key={a.title}>
                            <div className="card asset-card p-4 text-center h-100">
                                <div className="icon-box icon-box--sm mx-auto">
                                    <i className={`fas ${a.icon} fa-lg`}></i>
                                </div>
                                <h5 className="fw-bold mt-3 mb-2">{a.title}</h5>
                                <p className="text-muted small mb-0">{a.text}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            </section>

            {/* Conceptos: Fragmentos / Umbral / Seguridad */}
            <section className="section-band section-band--white" id="conceptos">
            <div className="container">
                <div className="text-center mb-5">
                    <h2 className="fw-bold">¿Cómo funciona Kleimos Legacy?</h2>
                    <div
                        className="mx-auto my-3"
                        style={{ width: '80px', height: '4px', background: 'var(--ipn-maroon)' }}
                    ></div>
                </div>

                <div className="row g-4">
                    {CONCEPTS.map((c) => (
                        <div className="col-md-4" key={c.title}>
                            <div className="card concept-card p-4">
                                <div className="icon-box">
                                    <i className={`fas ${c.icon} fa-2x`}></i>
                                </div>
                                <h4 className="fw-bold">{c.title}</h4>
                                {c.paragraphs.map((p, i) => (
                                    <p className="text-muted small" key={i}>
                                        {p}
                                    </p>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            </section>

            {/* Secreto compartido + animación */}
            <section className="section-band section-band--tint">
            <div className="container">
                <div className="row align-items-center">
                    <div className="col-lg-5 mb-5 mb-lg-0">
                        <h2 className="fw-bold mb-4">
                            Un Secreto que <span style={{ color: 'var(--sim-light-purple)' }}>nadie</span> posee solo
                        </h2>
                        <p className="text-muted lead">
                            Kleimos convierte tu acceso en un rompecabezas digital. Lo repartimos entre personas de
                            confianza, y solo cuando se reúnen las piezas necesarias, puedes recuperar tu patrimonio.
                        </p>

                        <div className="d-flex align-items-center gap-4 mt-4">
                            <div className="text-center">
                                <h3 className="fw-bold mb-0">5</h3>
                                <small className="text-muted text-uppercase fw-bold">Elegidos</small>
                            </div>
                            <div className="vr"></div>
                            <div className="text-center">
                                <h3 className="fw-bold mb-0 text-success">3</h3>
                                <small className="text-muted text-uppercase fw-bold">Necesarios</small>
                            </div>
                        </div>
                    </div>
                    <div className="col-lg-7">
                        <ShamirAnimation />
                    </div>
                </div>
            </div>
            </section>

            {/* Proceso / protocolo de emergencia */}
            <section className="section-band section-band--white" id="proceso">
            <div className="container">
                <div className="row align-items-center">
                    <div className="col-lg-6">
                        <img
                            src="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                            className="img-fluid rounded-4 shadow"
                            alt="Servidores seguros"
                        />
                    </div>
                    <div className="col-lg-6 ps-lg-5">
                        <h3 className="fw-bold" style={{ color: 'var(--ipn-maroon)' }}>
                            Un protocolo de emergencia real
                        </h3>
                        <p className="my-4 text-muted">
                            Kleimos no es una base de datos. Es un sistema efímero. Solo existimos cuando necesitas
                            recuperar tus activos. Nunca conocemos tus llaves y tampoco tus activos.
                        </p>
                        <ul className="list-unstyled">
                            {CHECKLIST.map((item) => (
                                <li className="mb-3" key={item.title}>
                                    <i className="fas fa-check-circle text-success me-2"></i>
                                    <strong>{item.title}</strong> {item.text}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            </section>

            {/* Aviso legal + Preguntas frecuentes */}
            <section className="section-band section-band--tint" id="faq">
            <div className="container">
                <div className="legal-notice d-flex align-items-start gap-3 mb-5">
                    <i className="fas fa-triangle-exclamation fa-2x flex-shrink-0"></i>
                    <div>
                        <h5 className="fw-bold mb-1">Aviso importante</h5>
                        <p className="mb-0">
                            Kleimos <strong>no es un testamento digital</strong> ni sustituye a un testamento físico
                            ante notario. Es una herramienta técnica para transferir el acceso a tus activos
                            digitales a las personas que elijas. Para la sucesión legal de tu patrimonio (bienes,
                            propiedades y disposiciones legales), siempre debes acudir con un notario público.
                        </p>
                    </div>
                </div>

                <div className="text-center mb-5">
                    <h2 className="fw-bold">Preguntas frecuentes</h2>
                    <div
                        className="mx-auto my-3"
                        style={{ width: '80px', height: '4px', background: 'var(--ipn-maroon)' }}
                    ></div>
                </div>

                <div className="row justify-content-center">
                    <div className="col-lg-9">
                        <FaqAccordion />
                    </div>
                </div>
            </div>
            </section>

            {/* Footer */}
            <footer className="bg-dark text-white py-5 mt-5">
                <div className="container text-center">
                    <div className="d-flex justify-content-center gap-4 mb-4">
                        <img
                            src="https://upload.wikimedia.org/wikipedia/commons/f/f8/Logo_Instituto_Polit%C3%A9cnico_Nacional.png"
                            alt="IPN"
                            style={{ height: '50px', filter: 'brightness(0) invert(1)' }}
                        />
                        <img
                            src="https://www.escom.ipn.mx/img/logoESCOMBlanco.png"
                            alt="ESCOM"
                            style={{ height: '40px' }}
                        />
                    </div>
                    <p className="small text-white-50">
                        © 2026 Kleimos Legacy · Ingeniería en Sistemas Computacionales · ESCOM-IPN
                    </p>
                </div>
            </footer>
        </div>
    );
}