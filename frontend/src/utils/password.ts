// Reglas de contraseña (RN-001). Deben coincidir con backend/app/schemas/usuario.py
// (_contrasena_robusta y REGLAS_CONTRASENA); el backend es quien decide.

export const SIMBOLOS_CONTRASENA = '!@#$%^&*(),.?":{}|<>';
export const LONGITUD_MIN_CONTRASENA = 12;
export const LONGITUD_MAX_CONTRASENA = 128;

export interface ReglaContrasena {
    clave: string;
    texto: string;
    cumple: (v: string) => boolean;
}

const tieneSimbolo = (v: string) => [...v].some((c) => SIMBOLOS_CONTRASENA.includes(c));

export const REGLAS_CONTRASENA: ReglaContrasena[] = [
    {
        clave: 'longitud',
        texto: `Mínimo ${LONGITUD_MIN_CONTRASENA} caracteres`,
        cumple: (v) => v.length >= LONGITUD_MIN_CONTRASENA,
    },
    { clave: 'mayuscula', texto: 'Una letra mayúscula (A-Z)', cumple: (v) => /[A-Z]/.test(v) },
    { clave: 'minuscula', texto: 'Una letra minúscula (a-z)', cumple: (v) => /[a-z]/.test(v) },
    { clave: 'numero', texto: 'Un número (0-9)', cumple: (v) => /[0-9]/.test(v) },
    {
        clave: 'simbolo',
        texto: `Un símbolo: ${SIMBOLOS_CONTRASENA.split('').join(' ')}`,
        cumple: tieneSimbolo,
    },
];

// El máximo no se muestra en la lista (nadie llega a 128); solo se avisa si se pasa.
export const contrasenaValida = (v: string) =>
    v.length <= LONGITUD_MAX_CONTRASENA && REGLAS_CONTRASENA.every((r) => r.cumple(v));

/** Primer requisito que falta, para el mensaje de error al enviar. */
export const requisitoFaltante = (v: string): string | null => {
    if (v.length > LONGITUD_MAX_CONTRASENA) {
        return `La contraseña no puede tener más de ${LONGITUD_MAX_CONTRASENA} caracteres.`;
    }
    const regla = REGLAS_CONTRASENA.find((r) => !r.cumple(v));
    return regla ? `La contraseña necesita: ${regla.texto.charAt(0).toLowerCase()}${regla.texto.slice(1)}.` : null;
};
