import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTheme, toggleTheme } from '../theme';
import './Home.css';
import KleimosLogo from '../components/brand/KleimosLogo';
import DemoShamir from '../components/home/DemoShamir';
import LanguageToggle from '../components/common/LanguageToggle';
import { getLang, t } from '../i18n';

// ---------------------------------------------------------------------------
// Datos estáticos de las secciones
// ---------------------------------------------------------------------------

// Son funciones (no constantes) para que los textos salgan en el idioma activo.

const concepts = () => [
    {
        icon: 'fa-puzzle-piece',
        title: t('1. Los Fragmentos', '1. The Shares'),
        paragraphs: [
            t(
                'Imagina que tu llave de acceso a tu patrimonio es un mapa del tesoro. En lugar de darle el mapa a una persona, lo dividimos en piezas llamadas fragmentos.',
                "Imagine the key to your estate is a treasure map. Instead of giving the map to one person, we split it into pieces called shares.",
            ),
            t(
                'Tener un solo fragmento no sirve de nada; no revela ninguna pista sobre la ubicación del tesoro.',
                "A single share is useless on its own; it doesn't reveal any clue about where the treasure is.",
            ),
        ],
    },
    {
        icon: 'fa-users-cog',
        title: t('2. El Umbral (k)', '2. The Threshold (k)'),
        paragraphs: [
            t(
                'Aquí está la magia: no necesitas todas las piezas para reconstruir el mapa. Tú decides cuántas son necesarias.',
                "Here's the magic: you don't need every piece to rebuild the map. You decide how many are required.",
            ),
            t(
                'Si repartes 5 fragmentos y pones un umbral de 3, el secreto se revelará en cuanto 3 de tus familiares, o amigos, se reúnan.',
                'If you hand out 5 shares and set a threshold of 3, the secret is revealed as soon as 3 of your relatives or friends come together.',
            ),
        ],
    },
    {
        icon: 'fa-lock',
        title: t('3. Seguridad Total', '3. Total Security'),
        paragraphs: [
            t(
                'Matemáticamente, es imposible adivinar tu llave de acceso si te falta aunque sea una sola pieza del umbral.',
                "Mathematically, it's impossible to guess your access key if even a single piece of the threshold is missing.",
            ),
            t(
                'Tus llaves están resguardadas por un esquema de Secreto Compartido.',
                'Your keys are protected by a Secret Sharing scheme.',
            ),
        ],
    },
];

const checklist = () => [
    {
        title: t('Cero Conocimiento:', 'Zero Knowledge:'),
        text: t('Nunca vemos tus archivos ni conocemos tus llaves.', 'We never see your files or know your keys.'),
    },
    {
        title: t('Descentralizado:', 'Decentralized:'),
        text: t('Tus familiares guardan las llaves, no nosotros.', 'Your loved ones keep the keys, not us.'),
    },
    {
        title: t('Piezas verificadas:', 'Verified pieces:'),
        text: t('Verificamos que nadie te dé una pieza falsa.', 'We check that nobody hands you a fake piece.'),
    },
];

const assetTypes = () => [
    {
        icon: 'fa-key',
        title: t('Contraseñas', 'Passwords'),
        text: t(
            'Todos tus accesos y cuentas importantes, cifrados en un solo lugar.',
            'All your important logins and accounts, encrypted in one place.',
        ),
    },
    {
        icon: 'fa-wallet',
        title: 'Seed Phrases',
        text: t(
            'Las frases de recuperación de tus wallets cripto, sin exponerlas nunca.',
            'The recovery phrases of your crypto wallets, never exposed.',
        ),
    },
    {
        icon: 'fa-file-contract',
        title: t('Documentos', 'Documents'),
        text: t(
            'Testamentos, escrituras, pólizas o cualquier archivo sensible.',
            'Wills, deeds, policies or any sensitive file.',
        ),
    },
    {
        icon: 'fa-id-badge',
        title: t('Credenciales', 'Credentials'),
        text: t(
            'Accesos a plataformas, licencias digitales y cuentas corporativas.',
            'Platform logins, digital licenses and corporate accounts.',
        ),
    },
];

const beforeItems = () => [
    t(
        'Contraseñas y seed phrases dispersas en notas, correos o la memoria de una sola persona.',
        "Passwords and seed phrases scattered across notes, emails or a single person's memory.",
    ),
    t(
        'Si te pasa algo, tu familia no sabe ni por dónde empezar a buscar tus accesos.',
        "If something happens to you, your family doesn't even know where to start looking for your logins.",
    ),
    t(
        'Un solo punto de fallo: si pierdes ese papel o USB, se pierde todo para siempre.',
        'A single point of failure: if you lose that paper or USB drive, everything is lost forever.',
    ),
    t(
        'Dependes de que un tercero (banco, plataforma) decida qué hacer con tus claves.',
        'You depend on a third party (bank, platform) deciding what to do with your keys.',
    ),
];

const afterItems = () => [
    t('Todo cifrado en un solo lugar, con una llave que solo tú controlas.', 'Everything encrypted in one place, with a key only you control.'),
    t('Un protocolo automático detecta tu inactividad y activa la sucesión.', 'An automatic protocol detects your inactivity and triggers the succession.'),
    t('Ningún custodio, por sí solo, puede acceder a tu bóveda.', 'No custodian can access your vault on their own.'),
    t(
        'Tus seres queridos reciben exactamente lo que definiste, sin intermediarios.',
        'Your loved ones receive exactly what you defined, with no intermediaries.',
    ),
];

const faqItems = () => [
    {
        question: t('¿Ustedes pueden ver mis contraseñas o archivos?', 'Can you see my passwords or files?'),
        answer: t(
            'No. Todo se cifra en tu navegador antes de subirse. Solo guardamos lo necesario para comprobar que los fragmentos son auténticos, nunca la llave ni tus archivos.',
            'No. Everything is encrypted in your browser before it is uploaded. We only store what is needed to check that the shares are authentic, never the key or your files.',
        ),
    },
    {
        question: t('¿Un solo custodio puede acceder a mi bóveda?', 'Can a single custodian access my vault?'),
        answer: t(
            'No. La llave se divide en partes y se necesita un mínimo de ellas (tú decides cuántas) para reconstruirla. Ningún custodio individual tiene acceso por sí solo.',
            'No. The key is split into parts and a minimum of them (you decide how many) is needed to rebuild it. No individual custodian has access on their own.',
        ),
    },
    {
        question: t('¿Qué pasa si un custodio pierde su fragmento o no responde?', "What if a custodian loses their share or doesn't respond?"),
        answer: t(
            'Por eso se recomienda repartir más fragmentos (n) de los que se necesitan (k). Mientras sigan disponibles al menos k fragmentos válidos, la recuperación sigue siendo posible.',
            "That's why it's recommended to hand out more shares (n) than are needed (k). As long as at least k valid shares remain available, recovery is still possible.",
        ),
    },
    {
        question: t('¿Qué pasa si no respondo las pruebas de vida pero sigo bien?', "What if I don't answer the proof-of-life checks but I'm fine?"),
        answer: t(
            'Existe un periodo de gracia configurable antes de que se active cualquier alerta o proceso de recuperación, para evitar falsas alarmas.',
            'There is a configurable grace period before any alert or recovery process is triggered, to avoid false alarms.',
        ),
    },
    {
        question: t(
            '¿Cuánto tiempo tienen mis beneficiarios para completar la recuperación?',
            'How long do my beneficiaries have to complete the recovery?',
        ),
        answer: t(
            'Una vez confirmada la inactividad, hay un plazo único e improrrogable de 12 meses. Si no se completa en ese periodo, los archivos se eliminan.',
            "Once inactivity is confirmed, there is a single, non-extendable 12-month window. If recovery isn't completed in that time, the files are deleted.",
        ),
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

const stepLabel = (s: Step): string =>
    ({
        idle: t('Protegiendo acceso...', 'Protecting access...'),
        split: t('Dividiendo en 5 piezas...', 'Splitting into 5 pieces...'),
        quorum: t('Recuperación: 3 personas se reúnen...', 'Recovery: 3 people come together...'),
        success: t('¡Acceso Restaurado!', 'Access Restored!'),
    })[s];

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
            <div className="anim-label">{stepLabel(step)}</div>

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
            {faqItems().map((item, i) => {
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
        <>
            <LanguageToggle />
            <button
                type="button"
                className="theme-toggle"
                onClick={() => setTheme(toggleTheme())}
                title={theme === 'dark' ? t('Modo claro', 'Light mode') : t('Modo oscuro', 'Dark mode')}
                aria-label={t('Cambiar tema', 'Toggle theme')}
            >
                <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
            </button>
        </>
    );

    return (
        <div className="home-page">
            {/* Navbar */}
            <nav className="navbar navbar-expand-lg navbar-clean sticky-top">
                <div className="container">
                    <a className="navbar-brand" href="#top" aria-label={t('Kleimos Legacy, inicio', 'Kleimos Legacy, home')}>
                        <KleimosLogo tamano="sm" />
                    </a>

                    {/* Hamburguesa — solo móvil/tablet */}
                    <button
                        type="button"
                        className="home-nav-toggler d-lg-none"
                        onClick={() => setMenuOpen((o) => !o)}
                        aria-label={menuOpen ? t('Cerrar menú', 'Close menu') : t('Abrir menú', 'Open menu')}
                        aria-expanded={menuOpen}
                    >
                        <i className={`fas ${menuOpen ? 'fa-times' : 'fa-bars'}`}></i>
                    </button>

                    {/* Acciones en línea — solo escritorio */}
                    <div className="ms-auto d-none d-lg-flex gap-2 align-items-center">
                        <a href="#conceptos" className="home-nav-link">{t('Conceptos', 'Concepts')}</a>
                        <a href="#demo" className="home-nav-link home-nav-link--demo">
                            <i className="fas fa-puzzle-piece me-1"></i>{t('Pruébalo', 'Try it')}
                        </a>
                        <a href="#proceso" className="home-nav-link">{t('Proceso', 'Process')}</a>
                        <a href="#faq" className="home-nav-link">FAQ</a>
                        {themeBtn}
                        <Link to="/login" className="btn btn-outline-secondary rounded-pill px-4">
                            {t('Ingresar', 'Sign in')}
                        </Link>
                        <Link to="/recuperacion" className="btn-ipn">
                            {t('Comenzar Recuperación', 'Start Recovery')}
                        </Link>
                    </div>
                </div>

                {/* Panel colapsable — solo móvil, al abrir */}
                {menuOpen && (
                    <div className="home-nav-menu d-lg-none">
                        <a href="#conceptos" onClick={closeMenu}>{t('Conceptos', 'Concepts')}</a>
                        <a href="#demo" className="home-nav-link--demo" onClick={closeMenu}>
                            <i className="fas fa-puzzle-piece me-2"></i>{t('Pruébalo', 'Try it')}
                        </a>
                        <a href="#proceso" onClick={closeMenu}>{t('Proceso', 'Process')}</a>
                        <a href="#faq" onClick={closeMenu}>FAQ</a>
                        <div className="d-flex align-items-center gap-2 mt-2">
                            {themeBtn}
                            <Link to="/login" className="btn btn-outline-secondary rounded-pill flex-grow-1" onClick={closeMenu}>
                                {t('Ingresar', 'Sign in')}
                            </Link>
                        </div>
                        <Link to="/recuperacion" className="btn-ipn w-100 text-center mt-2" onClick={closeMenu}>
                            {t('Comenzar Recuperación', 'Start Recovery')}
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

                            <h1 className="home-hero-titulo">{t('Protege tu patrimonio digital', 'Protect your digital estate')}</h1>
                            <p className="home-hero-sub">
                                {t('Tus archivos, cifrados y repartidos entre personas de confianza, llegan a quien tú elijas si algo te pasa.', 'Your files, encrypted and shared among people you trust, reach whoever you choose if something happens to you.')}
                            </p>

                            <a href="#conceptos" className="btn btn-lg rounded-pill fw-bold px-5 shadow-lg home-hero-btn">
                                <i className="fas fa-microchip me-2"></i>{t('Empezar', 'Get started')}
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            {/* Antes / Después: riesgo sin Kleimos vs. protegido con Kleimos */}
            <section className="section-band section-band--white">
            <div className="container">
                <div className="text-center mb-5">
                    <h2 className="fw-bold">{t('Tu patrimonio digital, hoy vs. con Kleimos', 'Your digital estate, today vs. with Kleimos')}</h2>
                    <div
                        className="mx-auto my-3"
                        style={{ width: '80px', height: '4px', background: 'var(--ipn-maroon)' }}
                    ></div>
                </div>

                <div className="row g-4">
                    <div className="col-md-6">
                        <div className="card risk-card risk-card--before p-4 h-100">
                            <span className="risk-badge risk-badge--before">
                                <i className="fas fa-triangle-exclamation me-2"></i>{t('Hoy, sin protección', 'Today, unprotected')}
                            </span>
                            <ul className="list-unstyled mt-4 mb-0">
                                {beforeItems().map((text) => (
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
                                <i className="fas fa-shield-heart me-2"></i>{t('Con Kleimos', 'With Kleimos')}
                            </span>
                            <ul className="list-unstyled mt-4 mb-0">
                                {afterItems().map((text) => (
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
                    <h2 className="fw-bold">{t('¿Qué puedes guardar en tu bóveda?', 'What can you keep in your vault?')}</h2>
                    <div
                        className="mx-auto my-3"
                        style={{ width: '80px', height: '4px', background: 'var(--ipn-maroon)' }}
                    ></div>
                </div>

                <div className="row g-4">
                    {assetTypes().map((a) => (
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
                    <h2 className="fw-bold">{t('¿Cómo funciona Kleimos Legacy?', 'How does Kleimos Legacy work?')}</h2>
                    <div
                        className="mx-auto my-3"
                        style={{ width: '80px', height: '4px', background: 'var(--ipn-maroon)' }}
                    ></div>
                </div>

                <div className="row g-4">
                    {concepts().map((c) => (
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
                            {getLang() === 'es' ? (
                                <>
                                    Un Secreto que <span style={{ color: 'var(--sim-light-purple)' }}>nadie</span> posee solo
                                </>
                            ) : (
                                <>
                                    A Secret that <span style={{ color: 'var(--sim-light-purple)' }}>nobody</span> holds alone
                                </>
                            )}
                        </h2>
                        <p className="text-muted lead">
                            {t('Kleimos convierte tu acceso en un rompecabezas digital. Lo repartimos entre personas de confianza, y solo cuando se reúnen las piezas necesarias, puedes recuperar tu patrimonio.', 'Kleimos turns your access into a digital puzzle. We share it among people you trust, and only when the required pieces come together can your estate be recovered.')}
                        </p>

                        <div className="d-flex align-items-center gap-4 mt-4">
                            <div className="text-center">
                                <h3 className="fw-bold mb-0">5</h3>
                                <small className="text-muted text-uppercase fw-bold">{t('Elegidos', 'Chosen')}</small>
                            </div>
                            <div className="vr"></div>
                            <div className="text-center">
                                <h3 className="fw-bold mb-0 text-success">3</h3>
                                <small className="text-muted text-uppercase fw-bold">{t('Necesarios', 'Required')}</small>
                            </div>
                        </div>

                        <a href="#demo" className="btn-ipn mt-4">
                            <i className="fas fa-puzzle-piece me-2"></i>{t('Pruébalo tú mismo', 'Try it yourself')}
                        </a>
                    </div>
                    <div className="col-lg-7">
                        <ShamirAnimation />
                    </div>
                </div>
            </div>
            </section>

            {/* Actividad interactiva: fragmentar y recuperar una palabra (simulación, sin el motor SSS).
                Trae su propia banda destacada, ver components/home/DemoShamir. */}
            <DemoShamir />

            {/* Proceso / protocolo de emergencia */}
            <section className="section-band section-band--white" id="proceso">
            <div className="container">
                <div className="row align-items-center">
                    <div className="col-lg-6">
                        <img
                            src="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
                            className="img-fluid rounded-4 shadow"
                            alt={t('Servidores seguros', 'Secure servers')}
                        />
                    </div>
                    <div className="col-lg-6 ps-lg-5">
                        <h3 className="fw-bold" style={{ color: 'var(--ipn-maroon)' }}>
                            {t('Un protocolo de emergencia real', 'A real emergency protocol')}
                        </h3>
                        <p className="my-4 text-muted">
                            {t('Kleimos no es una base de datos. Es un sistema efímero. Solo existimos cuando necesitas recuperar tus activos. Nunca conocemos tus llaves y tampoco tus activos.', "Kleimos isn't a database. It's an ephemeral system. We only exist when you need to recover your assets. We never know your keys or your assets.")}
                        </p>
                        <ul className="list-unstyled">
                            {checklist().map((item) => (
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
                        <h5 className="fw-bold mb-1">{t('Aviso importante', 'Important notice')}</h5>
                        {getLang() === 'es' ? (
                            <p className="mb-0">
                                Kleimos <strong>no es un testamento digital</strong> ni sustituye a un testamento físico
                                ante notario. Es una herramienta técnica para transferir el acceso a tus activos
                                digitales a las personas que elijas. Para la sucesión legal de tu patrimonio (bienes,
                                propiedades y disposiciones legales), siempre debes acudir con un notario público.
                            </p>
                        ) : (
                            <p className="mb-0">
                                Kleimos <strong>is not a digital will</strong> and doesn't replace a will made before a
                                notary. It's a technical tool to transfer access to your digital assets to the people you
                                choose. For the legal succession of your estate (goods, property and legal provisions),
                                you should always see a notary public.
                            </p>
                        )}
                    </div>
                </div>

                <div className="text-center mb-5">
                    <h2 className="fw-bold">{t('Preguntas frecuentes', 'Frequently asked questions')}</h2>
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
                        {t('© 2026 Kleimos Legacy · Ingeniería en Sistemas Computacionales · ESCOM-IPN', '© 2026 Kleimos Legacy · Computer Systems Engineering · ESCOM-IPN')}
                    </p>
                </div>
            </footer>
        </div>
    );
}