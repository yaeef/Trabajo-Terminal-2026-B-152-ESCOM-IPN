import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import './DemoShamir.css';
import { getLang, t } from '../../i18n';

// Actividad didáctica de la landing: NO usa el motor SSS (crypto/sss.ts).
// La «llave» es la palabra en hexadecimal y los fragmentos son códigos al
// azar; solo ilustra la regla de Shamir: con k fragmentos cualesquiera se
// recupera la llave y con menos no se sabe nada de ella.

const MAX_LETRAS = 16;
const N_MAX = 10; // mismo tope de fragmentos que la app (NuevaBoveda)
const K_MIN = 2;
const TIPO_ARRASTRE = 'application/x-kleimos-fragmento';

type Lugar = 'repartidos' | 'zona';
type Fragmento = { id: number; codigo: string };

const rango = (a: number, b: number) => Array.from({ length: Math.max(b - a + 1, 0) }, (_, i) => a + i);
const aHex = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

// --- Figura de la pieza (SVG 100×100): cuerpo de LADO con MARGEN para las pestañas ---
const MARGEN = 16;
const LADO = 68;
// Pestaña en coordenadas del borde: u a lo largo (0..1), v hacia fuera (fracción de LADO).
const PESTANA = [
    [0.43, 0, 0.45, 0.025, 0.43, 0.055],
    [0.4, 0.09, 0.33, 0.105, 0.34, 0.155],
    [0.35, 0.205, 0.44, 0.22, 0.5, 0.22],
    [0.56, 0.22, 0.65, 0.205, 0.66, 0.155],
    [0.67, 0.105, 0.6, 0.09, 0.57, 0.055],
    [0.55, 0.025, 0.57, 0, 0.6, 0],
];
// Lados en sentido horario (arriba, derecha, abajo, izquierda): 1 pestaña, -1 hueco.
const PATRONES = [
    [1, 1, -1, -1],
    [-1, 1, 1, -1],
    [1, -1, -1, 1],
    [-1, -1, 1, 1],
    [1, -1, 1, -1],
];
const ESQUINAS = [
    [MARGEN, MARGEN],
    [MARGEN + LADO, MARGEN],
    [MARGEN + LADO, MARGEN + LADO],
    [MARGEN, MARGEN + LADO],
];

function trazoPieza(lados: number[]): string {
    const r = (x: number) => Math.round(x * 10) / 10;
    let d = `M${MARGEN} ${MARGEN}`;
    lados.forEach((signo, i) => {
        const [ax, ay] = ESQUINAS[i];
        const [bx, by] = ESQUINAS[(i + 1) % 4];
        const dx = (bx - ax) / LADO;
        const dy = (by - ay) / LADO;
        // Normal hacia fuera del cuerpo (recorrido horario con y hacia abajo): (dy, -dx).
        const p = (u: number, v: number) =>
            `${r(ax + (dx * u + dy * v * signo) * LADO)} ${r(ay + (dy * u - dx * v * signo) * LADO)}`;
        d += ` L${p(0.4, 0)}`;
        for (const [a, b, c, e, f, g] of PESTANA) d += ` C${p(a, b)} ${p(c, e)} ${p(f, g)}`;
        d += ` L${p(1, 0)}`;
    });
    return `${d} Z`;
}
const FORMAS = PATRONES.map(trazoPieza);

function Pieza({ f, n, accion, onMover }: { f: Fragmento; n: number; accion: string; onMover: () => void }) {
    const alTeclear = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onMover();
        }
    };
    const alArrastrar = (e: DragEvent) => {
        e.dataTransfer.setData(TIPO_ARRASTRE, String(f.id));
        e.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            role="button"
            tabIndex={0}
            draggable
            className="ds-pieza"
            style={{ '--ds-tono': Math.round(((f.id - 1) * 360) / n) } as CSSProperties}
            onClick={onMover}
            onKeyDown={alTeclear}
            onDragStart={alArrastrar}
            title={accion}
            aria-label={`${t('Fragmento', 'Share')} ${f.id}. ${accion}`}
        >
            <svg className="ds-pieza-forma" viewBox="0 0 100 100" aria-hidden="true">
                <path d={FORMAS[(f.id - 1) % FORMAS.length]} />
            </svg>
            <span className="ds-pieza-num">#{f.id}</span>
            <code className="ds-pieza-codigo">{f.codigo}</code>
        </div>
    );
}

function Actividad() {
    const [texto, setTexto] = useState('');
    const [palabra, setPalabra] = useState<string | null>(null);
    const [n, setN] = useState<number | null>(null);
    const [k, setK] = useState<number | null>(null);
    const [enZona, setEnZona] = useState<number[]>([]); // en orden de llegada
    const [sobre, setSobre] = useState<Lugar | null>(null);

    const llaveHex = useMemo(() => (palabra ? aHex(new TextEncoder().encode(palabra)) : ''), [palabra]);
    const llaveOculta = llaveHex.replace(/[0-9A-F]/g, '?');

    // Fragmentos nuevos cada vez que cambia la palabra, n o k (como en un reparto real).
    const fragmentos = useMemo<Fragmento[]>(
        () =>
            palabra && n && k
                ? rango(1, n).map((id) => ({ id, codigo: aHex(crypto.getRandomValues(new Uint8Array(4))) }))
                : [],
        [palabra, n, k],
    );

    const limpio = texto.trim();
    const repartidos = fragmentos.filter((f) => !enZona.includes(f.id));
    const reunidos = enZona.map((id) => fragmentos[id - 1]);
    const recuperada = k !== null && enZona.length >= k;

    const crearLlave = (e: FormEvent) => {
        e.preventDefault();
        if (!limpio) return;
        setPalabra(limpio);
        setEnZona([]);
    };
    const elegirN = (v: number) => {
        setN(v);
        if (k !== null && k > v) setK(null);
        setEnZona([]);
    };
    const elegirK = (v: number) => {
        setK(v);
        setEnZona([]);
    };
    const empezarDeNuevo = () => {
        setTexto('');
        setPalabra(null);
        setN(null);
        setK(null);
        setEnZona([]);
    };

    const meter = (id: number) => setEnZona((z) => (z.includes(id) ? z : [...z, id]));
    const sacar = (id: number) => setEnZona((z) => z.filter((x) => x !== id));

    // Arrastrar y soltar (escritorio). En móvil/teclado basta con tocar o Enter.
    const alPasar = (lugar: Lugar) => (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(TIPO_ARRASTRE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (sobre !== lugar) setSobre(lugar);
    };
    const alSalir = (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSobre(null);
    };
    const alSoltar = (lugar: Lugar) => (e: DragEvent) => {
        e.preventDefault();
        setSobre(null);
        const id = Number(e.dataTransfer.getData(TIPO_ARRASTRE));
        if (!n || !Number.isInteger(id) || id < 1 || id > n) return;
        if (lugar === 'zona') meter(id);
        else sacar(id);
    };
    const destino = (lugar: Lugar) => ({
        onDragOver: alPasar(lugar),
        onDragLeave: alSalir,
        onDrop: alSoltar(lugar),
    });

    const faltan = k !== null ? k - enZona.length : 0;
    const sobran = k !== null ? enZona.length - k : 0;

    return (
        <div className="ds-card">
            {/* Paso 1: palabra → llave simbólica */}
            <div className="ds-paso">
                <span className="ds-num">1</span>
                <div className="flex-grow-1">
                    <p className="ds-pregunta">{t('Escribe una palabra secreta', 'Type a secret word')}</p>
                    <form className="ds-form" onSubmit={crearLlave}>
                        <input
                            type="text"
                            className="form-control"
                            value={texto}
                            maxLength={MAX_LETRAS}
                            placeholder={t('Por ejemplo: TESORO', 'For example: TREASURE')}
                            aria-label={t('Palabra secreta', 'Secret word')}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(e) => setTexto(e.target.value)}
                        />
                        <button type="submit" className="btn-ipn ds-btn" disabled={!limpio || limpio === palabra}>
                            <i className="fas fa-key me-2" aria-hidden="true"></i>
                            {palabra ? t('Cambiar llave', 'Change key') : t('Crear llave', 'Create key')}
                        </button>
                    </form>

                    {palabra && (
                        <div className="ds-llave ds-aparece" key={palabra}>
                            <i className="fas fa-key ds-llave-icono" aria-hidden="true"></i>
                            <div className="ds-llave-texto">
                                <small className="ds-etiqueta">{t('Tu llave simbólica', 'Your symbolic key')}</small>
                                <code className="ds-hex">{llaveHex}</code>
                                <small className="text-muted d-block">
                                    {t(`Es «${palabra}» convertida en números: así la ve la computadora.`, `It's “${palabra}” turned into numbers: that's how the computer sees it.`)}
                                </small>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Paso 2: total de fragmentos (n) */}
            {palabra && (
                <div className="ds-paso ds-aparece">
                    <span className="ds-num">2</span>
                    <div className="flex-grow-1">
                        <p className="ds-pregunta">{t('¿En cuántos fragmentos la divides? (n)', 'How many shares do you split it into? (n)')}</p>
                        <p className="text-muted small mb-2">{t('Cada fragmento lo guardaría una persona de confianza distinta.', 'Each share would be kept by a different trusted person.')}</p>
                        <div className="ds-opciones" role="group" aria-label={t('Total de fragmentos', 'Total shares')}>
                            {rango(K_MIN, N_MAX).map((v) => (
                                <button
                                    key={v}
                                    type="button"
                                    className={`ds-opcion ${n === v ? 'activa' : ''}`}
                                    aria-pressed={n === v}
                                    onClick={() => elegirN(v)}
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Paso 3: umbral (k) */}
            {palabra && n && (
                <div className="ds-paso ds-aparece">
                    <span className="ds-num">3</span>
                    <div className="flex-grow-1">
                        <p className="ds-pregunta">{t('¿Cuántos se necesitan para recuperarla? (umbral k)', 'How many are needed to recover it? (threshold k)')}</p>
                        <p className="text-muted small mb-2">
                            {n === K_MIN
                                ? t(`Con ${n} fragmentos se necesitan los ${n}.`, `With ${n} shares, all ${n} are needed.`)
                                : t(`Puede ser cualquier número entre ${K_MIN} y ${n}.`, `It can be any number between ${K_MIN} and ${n}.`)}
                        </p>
                        <div className="ds-opciones" role="group" aria-label={t('Fragmentos necesarios para recuperar', 'Shares needed to recover')}>
                            {rango(K_MIN, n).map((v) => (
                                <button
                                    key={v}
                                    type="button"
                                    className={`ds-opcion ${k === v ? 'activa' : ''}`}
                                    aria-pressed={k === v}
                                    onClick={() => elegirK(v)}
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Reparto y recuperación */}
            {palabra && n && k && (
                <div className="ds-demo ds-aparece">
                    <p className="ds-instruccion">
                        <i className="fas fa-hand-pointer me-2" aria-hidden="true"></i>
                        {getLang() === 'es' ? (
                            <>
                                Arrastra fragmentos a la zona de recuperación (o tócalos). Se necesitan{' '}
                                <strong>{k} de {n}</strong>, los que tú quieras.
                            </>
                        ) : (
                            <>
                                Drag shares to the recovery zone (or tap them). You need{' '}
                                <strong>{k} of {n}</strong>, whichever you like.
                            </>
                        )}
                    </p>

                    <div className="row g-4">
                        <div className="col-lg-6">
                            <div className={`ds-panel ${sobre === 'repartidos' ? 'is-over' : ''}`} {...destino('repartidos')}>
                                <div className="ds-panel-cabecera">
                                    <span>
                                        <i className="fas fa-users me-2" aria-hidden="true"></i>{t('Fragmentos repartidos', 'Distributed shares')}
                                    </span>
                                    <span className="ds-contador">
                                        {repartidos.length}/{n}
                                    </span>
                                </div>
                                {repartidos.length > 0 ? (
                                    <div className="ds-piezas">
                                        {repartidos.map((f) => (
                                            <Pieza key={f.id} f={f} n={n} accion={t('Mover a la zona de recuperación', 'Move to the recovery zone')} onMover={() => meter(f.id)} />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="ds-vacio">{t('Todos los fragmentos están en la zona de recuperación.', 'All shares are in the recovery zone.')}</p>
                                )}
                                <p className="text-muted small mb-0 mt-auto pt-3">
                                    {t('Ningún fragmento revela nada de la llave: sus números parecen al azar.', 'No share reveals anything about the key: its numbers look random.')}
                                </p>
                            </div>
                        </div>

                        <div className="col-lg-6">
                            <div
                                className={`ds-panel ds-zona ${sobre === 'zona' ? 'is-over' : ''} ${recuperada ? 'is-ok' : ''}`}
                                {...destino('zona')}
                            >
                                <div className="ds-panel-cabecera">
                                    <span>
                                        <i className={`fas ${recuperada ? 'fa-lock-open' : 'fa-lock'} me-2`} aria-hidden="true"></i>
                                        {t('Zona de recuperación', 'Recovery zone')}
                                    </span>
                                    <span className="ds-contador">
                                        {enZona.length}/{k}
                                    </span>
                                </div>

                                <div className="ds-progreso" aria-hidden="true">
                                    {rango(1, k).map((i) => (
                                        <span key={i} className={i <= enZona.length ? 'lleno' : ''}></span>
                                    ))}
                                </div>

                                {reunidos.length > 0 ? (
                                    <div className="ds-piezas">
                                        {reunidos.map((f) => (
                                            <Pieza key={f.id} f={f} n={n} accion={t('Devolver a los fragmentos repartidos', 'Return to the distributed shares')} onMover={() => sacar(f.id)} />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="ds-vacio">
                                        <i className="fas fa-arrow-down me-2" aria-hidden="true"></i>{t('Suelta aquí los fragmentos', 'Drop the shares here')}
                                    </p>
                                )}

                                <div className="ds-resultado" aria-live="polite">
                                    {recuperada ? (
                                        <div className="ds-aparece ds-exito" key="ok">
                                            <i className="fas fa-key ds-resultado-icono" aria-hidden="true"></i>
                                            <small className="ds-etiqueta">{t('¡Llave reconstruida!', 'Key rebuilt!')}</small>
                                            <code className="ds-hex">{llaveHex}</code>
                                            <p className="mb-1">{t('La palabra secreta es', 'The secret word is')}</p>
                                            <strong className="ds-palabra">{palabra}</strong>
                                            <p className="text-muted small mb-0 mt-2">
                                                {getLang() === 'es' ? (
                                                    <>
                                                        Usaste los fragmentos {enZona.map((id) => `#${id}`).join(', ')}. Cualquier
                                                        combinación de {k} funciona
                                                        {sobran > 0 ? `; ${sobran === 1 ? 'te sobró 1' : `te sobraron ${sobran}`}` : ''}.
                                                    </>
                                                ) : (
                                                    <>
                                                        You used shares {enZona.map((id) => `#${id}`).join(', ')}. Any combination
                                                        of {k} works
                                                        {sobran > 0 ? `; ${sobran === 1 ? '1 was left over' : `${sobran} were left over`}` : ''}.
                                                    </>
                                                )}
                                            </p>
                                        </div>
                                    ) : (
                                        <div key="bloqueada">
                                            <i className="fas fa-lock ds-resultado-icono" aria-hidden="true"></i>
                                            <small className="ds-etiqueta">{t('Llave bloqueada', 'Key locked')}</small>
                                            <code className="ds-hex">{llaveOculta}</code>
                                            <p className="text-muted small mb-0">
                                                {enZona.length === 0
                                                    ? t(
                                                          `Reúne ${k} fragmentos cualesquiera para reconstruirla.`,
                                                          `Gather any ${k} shares to rebuild it.`,
                                                      )
                                                    : t(
                                                          `${faltan === 1 ? 'Falta' : 'Faltan'} ${faltan}. Con ${enZona.length} ${enZona.length === 1 ? 'fragmento' : 'fragmentos'} todavía no se sabe ni una letra.`,
                                                          `${faltan} more needed. With ${enZona.length} ${enZona.length === 1 ? 'share' : 'shares'} not a single letter is known yet.`,
                                                      )}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="d-flex flex-wrap justify-content-center gap-2 mt-4">
                        <button type="button" className="btn btn-outline-secondary rounded-pill px-4" onClick={() => setEnZona([])} disabled={enZona.length === 0}>
                            <i className="fas fa-rotate-left me-2" aria-hidden="true"></i>{t('Devolver fragmentos', 'Return shares')}
                        </button>
                        <button type="button" className="btn btn-outline-secondary rounded-pill px-4" onClick={empezarDeNuevo}>
                            <i className="fas fa-eraser me-2" aria-hidden="true"></i>{t('Empezar de nuevo', 'Start over')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// Sección completa de la landing: banda destacada, encabezado y la actividad.
// Entra con animación la primera vez que aparece en pantalla al hacer scroll.
export default function DemoShamir() {
    const ref = useRef<HTMLElement>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el || !('IntersectionObserver' in window)) {
            setVisible(true);
            return;
        }
        const io = new IntersectionObserver(
            ([entrada]) => {
                if (entrada.isIntersecting) {
                    setVisible(true);
                    io.disconnect();
                }
            },
            { threshold: 0.12 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    return (
        <section ref={ref} id="demo" className={`section-band ds-seccion ${visible ? 'is-visible' : ''}`}>
            {/* Piezas grandes y translúcidas de fondo (decoración) */}
            {rango(1, 5).map((i) => (
                <svg key={i} className={`ds-deco ds-deco-${i}`} viewBox="0 0 100 100" aria-hidden="true">
                    <path d={FORMAS[(i - 1) % FORMAS.length]} />
                </svg>
            ))}

            <div className="container">
                <div className="ds-encabezado ds-entrada">
                    <span className="ds-eyebrow">
                        <i className="fas fa-hand-pointer me-2" aria-hidden="true"></i>{t('Actividad interactiva', 'Interactive activity')}
                    </span>
                    <h2 className="ds-titulo">{t('Pruébalo tú mismo', 'Try it yourself')}</h2>
                    <div className="ds-divisor"></div>
                    <p className="ds-subtitulo">
                        {t('Convierte una palabra en llave, divídela en fragmentos y reúne los necesarios para recuperarla. Es solo una simulación: lo que escribas no sale de tu navegador.', "Turn a word into a key, split it into shares and gather the ones needed to recover it. It's only a simulation: whatever you type never leaves your browser.")}
                    </p>
                    <ol className="ds-resumen">
                        <li>
                            <i className="fas fa-key" aria-hidden="true"></i>{t('Crea una llave', 'Create a key')}
                        </li>
                        <li>
                            <i className="fas fa-puzzle-piece" aria-hidden="true"></i>{t('Divídela en fragmentos', 'Split it into shares')}
                        </li>
                        <li>
                            <i className="fas fa-lock-open" aria-hidden="true"></i>{t('Reúne los necesarios', 'Gather the ones needed')}
                        </li>
                    </ol>
                </div>
                <div className="ds-entrada ds-entrada--tarde">
                    <Actividad />
                </div>
            </div>
        </section>
    );
}
