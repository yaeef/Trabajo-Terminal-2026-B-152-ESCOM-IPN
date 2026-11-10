import './KleimosLogo.css';

/*
 * Marca Kleimos Legacy (propuesta B, «Greca»): la greca griega —en inglés
 * «Greek key»— se recorre hacia el centro, donde un punto dorado es la
 * memoria (Kleidouchos, el guardián de las llaves + Mnemósine, la memoria).
 * Los colores salen de variables CSS (KleimosLogo.css), así que se adapta
 * solo al modo oscuro; `tono="oscuro"` lo fuerza sobre fondos oscuros.
 */

const GRECA = 'M24 100V24H96V84H40V40H80V68H56V56';

interface MarcaProps {
    tamano?: number;
    /** Texto alternativo; sin él la marca es decorativa (va junto al nombre). */
    titulo?: string;
    className?: string;
}

/** Solo el símbolo (la greca con la memoria al centro). */
export function KleimosMarca({ tamano = 40, titulo, className = '' }: MarcaProps) {
    const accesible = titulo ? { role: 'img', 'aria-label': titulo } : { 'aria-hidden': true as const };
    return (
        <svg viewBox="0 0 120 120" width={tamano} height={tamano} className={`kleimos-marca ${className}`} {...accesible}>
            <path
                d={GRECA}
                fill="none"
                className="kleimos-trazo"
                strokeWidth={tamano < 24 ? 14 : 8}
                strokeLinecap="square"
                strokeLinejoin="miter"
            />
            {tamano >= 24 && <circle cx="68" cy="52" r="5" className="kleimos-oro" />}
            {tamano >= 40 && <path d="M24 100V88" fill="none" className="kleimos-oro-trazo" strokeWidth="8" strokeLinecap="square" />}
        </svg>
    );
}

type Tamano = 'sm' | 'md' | 'lg';

const MEDIDAS: Record<Tamano, { marca: number; nombre: number; legacy: number }> = {
    sm: { marca: 34, nombre: 24, legacy: 9 },
    md: { marca: 48, nombre: 34, legacy: 11 },
    lg: { marca: 88, nombre: 60, legacy: 15 },
};

interface LogoProps {
    tamano?: Tamano;
    /** 'auto' sigue el tema de la app; 'oscuro' para fondos oscuros (p. ej. el hero o el pie). */
    tono?: 'auto' | 'oscuro';
    /** Oculta «LEGACY» (espacios muy angostos). */
    soloNombre?: boolean;
    className?: string;
}

/** Logo completo: símbolo + KLEIMOS + LEGACY. */
export default function KleimosLogo({ tamano = 'md', tono = 'auto', soloNombre = false, className = '' }: LogoProps) {
    const m = MEDIDAS[tamano];
    return (
        <span
            className={`kleimos-logo ${tono === 'oscuro' ? 'kleimos-tono-oscuro' : ''} ${className}`}
            role="img"
            aria-label="Kleimos Legacy"
        >
            <KleimosMarca tamano={m.marca} />
            <span className="kleimos-texto" aria-hidden="true">
                <span className="kleimos-nombre" style={{ fontSize: m.nombre }}>
                    KLEIMOS
                </span>
                {!soloNombre && (
                    <span className="kleimos-legacy" style={{ fontSize: m.legacy }}>
                        LEGACY
                    </span>
                )}
            </span>
        </span>
    );
}
