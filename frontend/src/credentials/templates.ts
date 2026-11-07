// src/credentials/templates.ts
//
// Catálogo de plantillas de credenciales para activos de bóveda.
//
// Una plantilla solo describe qué campos pedir; el formulario dinámico
// (CredentialForm) los pinta y produce un JSON canónico (CredentialEnvelope)
// que se cifra en el navegador con la DEK de la bóveda y se sube como un
// activo normal, igual que un archivo. El backend nunca ve el contenido:
// solo persiste el id de plantilla en `activos_digitales.plantilla` para
// poder pintar el listado sin pedir la pass-phrase.

export type CampoTipo = 'text' | 'password' | 'textarea' | 'url' | 'number' | 'date';

export interface CampoPlantilla {
    key: string;
    label: string;
    tipo: CampoTipo;
    help?: string;
    /** Se enmascara en la vista y en la hoja PDF. Por defecto: tipo === 'password'. */
    secreto?: boolean;
}

export interface Plantilla {
    id: string;
    label: string;
    icon: string;          // clase Font Awesome
    descripcion: string;
    categoria: string;     // categoría de bóveda afín (informativo)
    identidad: string;     // key del campo que resume el activo (nombre por defecto)
    campos: CampoPlantilla[];
}

export const CRED_MIME = 'application/vnd.b152.credential+json';
export const CRED_SUFFIX = '.b152cred.json';
export const CRED_VERSION = 1 as const;

export interface CredentialEnvelope {
    b152_plantilla: string;
    version: typeof CRED_VERSION;
    creado_en: string;
    actualizado_en: string;
    campos: Record<string, string>;
}

export const PLANTILLAS: Plantilla[] = [
    {
        id: 'cripto_wallet',
        label: 'Cartera cripto',
        icon: 'fa-wallet',
        descripcion: 'Carteras frías o calientes, frase semilla y claves privadas.',
        categoria: 'Finanzas / Crypto',
        identidad: 'etiqueta',
        campos: [
            { key: 'red', label: 'Red / blockchain', tipo: 'text', help: 'Ej: Bitcoin, Ethereum, Solana…' },
            { key: 'tipo_cartera', label: 'Tipo', tipo: 'text', help: 'hardware · software · exchange · papel' },
            { key: 'etiqueta', label: 'Etiqueta o nombre', tipo: 'text' },
            { key: 'direccion_publica', label: 'Dirección pública', tipo: 'text' },
            { key: 'seed_phrase', label: 'Frase semilla (12 / 24 palabras)', tipo: 'textarea', secreto: true },
            { key: 'clave_privada', label: 'Clave privada', tipo: 'password' },
            { key: 'passphrase_25', label: 'Passphrase (25ª palabra)', tipo: 'password' },
            { key: 'pin', label: 'PIN del dispositivo', tipo: 'password' },
            { key: 'ubicacion_dispositivo', label: 'Ubicación física del dispositivo', tipo: 'text' },
            { key: 'notas_recuperacion', label: 'Notas de recuperación', tipo: 'textarea' },
        ],
    },
    {
        id: 'exchange',
        label: 'Cuenta de exchange',
        icon: 'fa-arrow-right-arrow-left',
        descripcion: 'Acceso a un exchange centralizado y sus llaves de API.',
        categoria: 'Finanzas / Crypto',
        identidad: 'exchange',
        campos: [
            { key: 'exchange', label: 'Exchange', tipo: 'text', help: 'Ej: Binance, Bitso, Kraken…' },
            { key: 'url', label: 'URL de acceso', tipo: 'url' },
            { key: 'usuario', label: 'Usuario / correo', tipo: 'text' },
            { key: 'password', label: 'Contraseña', tipo: 'password' },
            { key: 'metodo_2fa', label: 'Método 2FA', tipo: 'text', help: 'App TOTP, SMS, llave física…' },
            { key: 'codigos_respaldo', label: 'Códigos de respaldo 2FA', tipo: 'textarea', secreto: true },
            { key: 'api_key', label: 'API key', tipo: 'password' },
            { key: 'api_secret', label: 'API secret', tipo: 'password' },
            { key: 'notas', label: 'Notas', tipo: 'textarea' },
        ],
    },
    {
        id: 'cuenta_bancaria',
        label: 'Cuenta bancaria',
        icon: 'fa-building-columns',
        descripcion: 'Banca en línea, número de cuenta / CLABE y tarjetas.',
        categoria: 'Finanzas / Crypto',
        identidad: 'banco',
        campos: [
            { key: 'banco', label: 'Banco', tipo: 'text' },
            { key: 'titular', label: 'Titular', tipo: 'text' },
            { key: 'tipo_cuenta', label: 'Tipo de cuenta', tipo: 'text', help: 'Cheques, ahorro, nómina…' },
            { key: 'numero_cuenta', label: 'No. de cuenta / CLABE', tipo: 'text' },
            { key: 'tarjetas', label: 'Tarjetas asociadas', tipo: 'textarea', secreto: true },
            { key: 'usuario_banca', label: 'Usuario de banca en línea', tipo: 'text' },
            { key: 'password', label: 'Contraseña', tipo: 'password' },
            { key: 'nip', label: 'NIP', tipo: 'password' },
            { key: 'contacto_sucursal', label: 'Contacto / sucursal', tipo: 'text' },
            { key: 'notas', label: 'Notas', tipo: 'textarea' },
        ],
    },
    {
        id: 'cuenta_digital',
        label: 'Cuenta digital / red social',
        icon: 'fa-at',
        descripcion: 'Correo, redes sociales, dominios, suscripciones.',
        categoria: 'Cuentas Digitales',
        identidad: 'servicio',
        campos: [
            { key: 'servicio', label: 'Servicio', tipo: 'text', help: 'Ej: Gmail, Instagram, GoDaddy…' },
            { key: 'url', label: 'URL de acceso', tipo: 'url' },
            { key: 'usuario', label: 'Usuario / correo', tipo: 'text' },
            { key: 'password', label: 'Contraseña', tipo: 'password' },
            { key: 'metodo_2fa', label: 'Método 2FA', tipo: 'text' },
            { key: 'codigos_respaldo', label: 'Códigos de respaldo', tipo: 'textarea', secreto: true },
            { key: 'correo_recuperacion', label: 'Correo de recuperación', tipo: 'text' },
            { key: 'telefono_recuperacion', label: 'Teléfono de recuperación', tipo: 'text' },
            { key: 'notas', label: 'Notas', tipo: 'textarea' },
        ],
    },
    {
        id: 'acceso_generico',
        label: 'Acceso genérico',
        icon: 'fa-key',
        descripcion: 'Cualquier usuario / contraseña que no encaje en otra plantilla.',
        categoria: 'Accesos / Contraseñas',
        identidad: 'servicio',
        campos: [
            { key: 'servicio', label: 'Servicio', tipo: 'text' },
            { key: 'url', label: 'URL', tipo: 'url' },
            { key: 'usuario', label: 'Usuario', tipo: 'text' },
            { key: 'password', label: 'Contraseña', tipo: 'password' },
            { key: 'metodo_2fa', label: '2FA', tipo: 'text' },
            { key: 'notas', label: 'Notas', tipo: 'textarea' },
        ],
    },
    {
        id: 'poliza_seguro',
        label: 'Póliza de seguro',
        icon: 'fa-file-contract',
        descripcion: 'Pólizas de vida, gastos médicos o daños y sus beneficiarios.',
        categoria: 'Seguros y Beneficiarios',
        identidad: 'aseguradora',
        campos: [
            { key: 'aseguradora', label: 'Aseguradora', tipo: 'text' },
            { key: 'tipo', label: 'Tipo', tipo: 'text', help: 'Vida · gastos médicos · auto · hogar' },
            { key: 'numero_poliza', label: 'No. de póliza', tipo: 'text' },
            { key: 'titular', label: 'Titular', tipo: 'text' },
            { key: 'beneficiarios', label: 'Beneficiarios', tipo: 'textarea' },
            { key: 'suma_asegurada', label: 'Suma asegurada', tipo: 'text' },
            { key: 'vigencia', label: 'Vigencia', tipo: 'text' },
            { key: 'agente', label: 'Agente / contacto', tipo: 'text' },
            { key: 'notas', label: 'Notas', tipo: 'textarea' },
        ],
    },
    {
        id: 'credencial_servidor',
        label: 'Credencial de servidor / infra',
        icon: 'fa-server',
        descripcion: 'Accesos SSH, paneles y servicios de infraestructura.',
        categoria: 'Trabajo / Profesional',
        identidad: 'host',
        campos: [
            { key: 'host', label: 'Host / IP', tipo: 'text' },
            { key: 'servicio', label: 'Servicio', tipo: 'text', help: 'SSH, cPanel, base de datos…' },
            { key: 'puerto', label: 'Puerto', tipo: 'number' },
            { key: 'usuario', label: 'Usuario', tipo: 'text' },
            { key: 'metodo', label: 'Método', tipo: 'text', help: 'contraseña · llave SSH' },
            { key: 'password', label: 'Contraseña o ruta de la llave', tipo: 'password' },
            { key: 'passphrase_llave', label: 'Passphrase de la llave', tipo: 'password' },
            { key: 'notas', label: 'Notas', tipo: 'textarea' },
        ],
    },
    {
        id: 'documento_fisico',
        label: 'Documento / ubicación física',
        icon: 'fa-box-archive',
        descripcion: 'Dónde está un documento o bien y cómo acceder a él.',
        categoria: 'Propiedades y Patrimonio',
        identidad: 'tipo_documento',
        campos: [
            { key: 'tipo_documento', label: 'Tipo de documento o bien', tipo: 'text', help: 'Escritura, testamento, acta…' },
            { key: 'descripcion', label: 'Descripción', tipo: 'textarea' },
            { key: 'ubicacion_fisica', label: 'Ubicación física', tipo: 'text', help: 'Caja fuerte, caja de seguridad bancaria…' },
            { key: 'resguardante', label: 'Persona que lo resguarda', tipo: 'text' },
            { key: 'combinacion', label: 'Combinación / llave', tipo: 'password' },
            { key: 'notas', label: 'Notas', tipo: 'textarea' },
        ],
    },
    {
        id: 'nota_segura',
        label: 'Nota segura / instrucciones',
        icon: 'fa-note-sticky',
        descripcion: 'Texto libre: instrucciones de sucesión, contactos clave, etc.',
        categoria: 'Instrucciones de Sucesión',
        identidad: 'titulo',
        campos: [
            { key: 'titulo', label: 'Título', tipo: 'text' },
            { key: 'cuerpo', label: 'Contenido', tipo: 'textarea' },
        ],
    },
];

export function plantillaById(id: string | null | undefined): Plantilla | undefined {
    if (!id) return undefined;
    return PLANTILLAS.find((p) => p.id === id);
}

export function campoEsSecreto(c: CampoPlantilla): boolean {
    return c.secreto ?? c.tipo === 'password';
}

/** Nombre de activo por defecto a partir del campo "identidad" de la plantilla. */
export function nombrePorDefecto(p: Plantilla, campos: Record<string, string>): string {
    const base = (campos[p.identidad] || '').trim();
    return base ? `${p.label} — ${base}` : p.label;
}

/** Construye el JSON canónico que se cifrará y subirá. */
export function construirEnvelope(
    plantillaId: string,
    campos: Record<string, string>,
    previo?: CredentialEnvelope | null,
): CredentialEnvelope {
    const ahora = new Date().toISOString();
    // solo se guardan campos con valor, ya recortados
    const limpio: Record<string, string> = {};
    for (const [k, v] of Object.entries(campos)) {
        const t = (v ?? '').trim();
        if (t) limpio[k] = t;
    }
    return {
        b152_plantilla: plantillaId,
        version: CRED_VERSION,
        creado_en: previo?.creado_en ?? ahora,
        actualizado_en: ahora,
        campos: limpio,
    };
}

export function parseEnvelope(texto: string): CredentialEnvelope {
    const raw = JSON.parse(texto) as Partial<CredentialEnvelope>;
    if (!raw || typeof raw !== 'object' || !raw.b152_plantilla || typeof raw.campos !== 'object') {
        throw new Error('El activo no tiene el formato de una plantilla de credenciales.');
    }
    return {
        b152_plantilla: String(raw.b152_plantilla),
        version: CRED_VERSION,
        creado_en: raw.creado_en ?? new Date().toISOString(),
        actualizado_en: raw.actualizado_en ?? raw.creado_en ?? new Date().toISOString(),
        campos: (raw.campos ?? {}) as Record<string, string>,
    };
}
