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
//
// Las etiquetas se traducen al idioma activo (plantillas() se evalúa en cada
// llamada); el JSON cifrado solo guarda las `key`, nunca las etiquetas.

import { t } from '../i18n';

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

/** Catálogo con las etiquetas en el idioma activo. */
export const plantillas = (): Plantilla[] => [
    {
        id: 'cripto_wallet',
        label: t('Cartera cripto', 'Crypto wallet'),
        icon: 'fa-wallet',
        descripcion: t('Carteras frías o calientes, frase semilla y claves privadas.', 'Cold or hot wallets, seed phrase and private keys.'),
        categoria: 'Finanzas / Crypto',
        identidad: 'etiqueta',
        campos: [
            { key: 'red', label: t('Red / blockchain', 'Network / blockchain'), tipo: 'text', help: t('Ej: Bitcoin, Ethereum, Solana…', 'e.g. Bitcoin, Ethereum, Solana…') },
            { key: 'tipo_cartera', label: t('Tipo', 'Type'), tipo: 'text', help: t('hardware · software · exchange · papel', 'hardware · software · exchange · paper') },
            { key: 'etiqueta', label: t('Etiqueta o nombre', 'Label or name'), tipo: 'text' },
            { key: 'direccion_publica', label: t('Dirección pública', 'Public address'), tipo: 'text' },
            { key: 'seed_phrase', label: t('Frase semilla (12 / 24 palabras)', 'Seed phrase (12 / 24 words)'), tipo: 'textarea', secreto: true },
            { key: 'clave_privada', label: t('Clave privada', 'Private key'), tipo: 'password' },
            { key: 'passphrase_25', label: t('Passphrase (25ª palabra)', 'Passphrase (25th word)'), tipo: 'password' },
            { key: 'pin', label: t('PIN del dispositivo', 'Device PIN'), tipo: 'password' },
            { key: 'ubicacion_dispositivo', label: t('Ubicación física del dispositivo', 'Physical location of the device'), tipo: 'text' },
            { key: 'notas_recuperacion', label: t('Notas de recuperación', 'Recovery notes'), tipo: 'textarea' },
        ],
    },
    {
        id: 'exchange',
        label: t('Cuenta de exchange', 'Exchange account'),
        icon: 'fa-arrow-right-arrow-left',
        descripcion: t('Acceso a un exchange centralizado y sus llaves de API.', 'Access to a centralized exchange and its API keys.'),
        categoria: 'Finanzas / Crypto',
        identidad: 'exchange',
        campos: [
            { key: 'exchange', label: t('Exchange', 'Exchange'), tipo: 'text', help: t('Ej: Binance, Bitso, Kraken…', 'e.g. Binance, Bitso, Kraken…') },
            { key: 'url', label: t('URL de acceso', 'Login URL'), tipo: 'url' },
            { key: 'usuario', label: t('Usuario / correo', 'Username / email'), tipo: 'text' },
            { key: 'password', label: t('Contraseña', 'Password'), tipo: 'password' },
            { key: 'metodo_2fa', label: t('Método 2FA', '2FA method'), tipo: 'text', help: t('App TOTP, SMS, llave física…', 'TOTP app, SMS, hardware key…') },
            { key: 'codigos_respaldo', label: t('Códigos de respaldo 2FA', '2FA backup codes'), tipo: 'textarea', secreto: true },
            { key: 'api_key', label: t('API key', 'API key'), tipo: 'password' },
            { key: 'api_secret', label: t('API secret', 'API secret'), tipo: 'password' },
            { key: 'notas', label: t('Notas', 'Notes'), tipo: 'textarea' },
        ],
    },
    {
        id: 'cuenta_bancaria',
        label: t('Cuenta bancaria', 'Bank account'),
        icon: 'fa-building-columns',
        descripcion: t('Banca en línea, número de cuenta / CLABE y tarjetas.', 'Online banking, account number / CLABE and cards.'),
        categoria: 'Finanzas / Crypto',
        identidad: 'banco',
        campos: [
            { key: 'banco', label: t('Banco', 'Bank'), tipo: 'text' },
            { key: 'titular', label: t('Titular', 'Holder'), tipo: 'text' },
            { key: 'tipo_cuenta', label: t('Tipo de cuenta', 'Account type'), tipo: 'text', help: t('Cheques, ahorro, nómina…', 'Checking, savings, payroll…') },
            { key: 'numero_cuenta', label: t('No. de cuenta / CLABE', 'Account no. / CLABE'), tipo: 'text' },
            { key: 'tarjetas', label: t('Tarjetas asociadas', 'Linked cards'), tipo: 'textarea', secreto: true },
            { key: 'usuario_banca', label: t('Usuario de banca en línea', 'Online banking username'), tipo: 'text' },
            { key: 'password', label: t('Contraseña', 'Password'), tipo: 'password' },
            { key: 'nip', label: t('NIP', 'PIN'), tipo: 'password' },
            { key: 'contacto_sucursal', label: t('Contacto / sucursal', 'Contact / branch'), tipo: 'text' },
            { key: 'notas', label: t('Notas', 'Notes'), tipo: 'textarea' },
        ],
    },
    {
        id: 'cuenta_digital',
        label: t('Cuenta digital / red social', 'Digital account / social network'),
        icon: 'fa-at',
        descripcion: t('Correo, redes sociales, dominios, suscripciones.', 'Email, social networks, domains, subscriptions.'),
        categoria: 'Cuentas Digitales',
        identidad: 'servicio',
        campos: [
            { key: 'servicio', label: t('Servicio', 'Service'), tipo: 'text', help: t('Ej: Gmail, Instagram, GoDaddy…', 'e.g. Gmail, Instagram, GoDaddy…') },
            { key: 'url', label: t('URL de acceso', 'Login URL'), tipo: 'url' },
            { key: 'usuario', label: t('Usuario / correo', 'Username / email'), tipo: 'text' },
            { key: 'password', label: t('Contraseña', 'Password'), tipo: 'password' },
            { key: 'metodo_2fa', label: t('Método 2FA', '2FA method'), tipo: 'text' },
            { key: 'codigos_respaldo', label: t('Códigos de respaldo', 'Backup codes'), tipo: 'textarea', secreto: true },
            { key: 'correo_recuperacion', label: t('Correo de recuperación', 'Recovery email'), tipo: 'text' },
            { key: 'telefono_recuperacion', label: t('Teléfono de recuperación', 'Recovery phone'), tipo: 'text' },
            { key: 'notas', label: t('Notas', 'Notes'), tipo: 'textarea' },
        ],
    },
    {
        id: 'acceso_generico',
        label: t('Acceso genérico', 'Generic login'),
        icon: 'fa-key',
        descripcion: t('Cualquier usuario / contraseña que no encaje en otra plantilla.', "Any username / password that doesn't fit another template."),
        categoria: 'Accesos / Contraseñas',
        identidad: 'servicio',
        campos: [
            { key: 'servicio', label: t('Servicio', 'Service'), tipo: 'text' },
            { key: 'url', label: t('URL', 'URL'), tipo: 'url' },
            { key: 'usuario', label: t('Usuario', 'Username'), tipo: 'text' },
            { key: 'password', label: t('Contraseña', 'Password'), tipo: 'password' },
            { key: 'metodo_2fa', label: t('2FA', '2FA'), tipo: 'text' },
            { key: 'notas', label: t('Notas', 'Notes'), tipo: 'textarea' },
        ],
    },
    {
        id: 'poliza_seguro',
        label: t('Póliza de seguro', 'Insurance policy'),
        icon: 'fa-file-contract',
        descripcion: t('Pólizas de vida, gastos médicos o daños y sus beneficiarios.', 'Life, medical or property policies and their beneficiaries.'),
        categoria: 'Seguros y Beneficiarios',
        identidad: 'aseguradora',
        campos: [
            { key: 'aseguradora', label: t('Aseguradora', 'Insurer'), tipo: 'text' },
            { key: 'tipo', label: t('Tipo', 'Type'), tipo: 'text', help: t('Vida · gastos médicos · auto · hogar', 'Life · medical · auto · home') },
            { key: 'numero_poliza', label: t('No. de póliza', 'Policy no.'), tipo: 'text' },
            { key: 'titular', label: t('Titular', 'Holder'), tipo: 'text' },
            { key: 'beneficiarios', label: t('Beneficiarios', 'Beneficiaries'), tipo: 'textarea' },
            { key: 'suma_asegurada', label: t('Suma asegurada', 'Sum insured'), tipo: 'text' },
            { key: 'vigencia', label: t('Vigencia', 'Validity'), tipo: 'text' },
            { key: 'agente', label: t('Agente / contacto', 'Agent / contact'), tipo: 'text' },
            { key: 'notas', label: t('Notas', 'Notes'), tipo: 'textarea' },
        ],
    },
    {
        id: 'credencial_servidor',
        label: t('Credencial de servidor / infra', 'Server / infra credential'),
        icon: 'fa-server',
        descripcion: t('Accesos SSH, paneles y servicios de infraestructura.', 'SSH access, panels and infrastructure services.'),
        categoria: 'Trabajo / Profesional',
        identidad: 'host',
        campos: [
            { key: 'host', label: t('Host / IP', 'Host / IP'), tipo: 'text' },
            { key: 'servicio', label: t('Servicio', 'Service'), tipo: 'text', help: t('SSH, cPanel, base de datos…', 'SSH, cPanel, database…') },
            { key: 'puerto', label: t('Puerto', 'Port'), tipo: 'number' },
            { key: 'usuario', label: t('Usuario', 'Username'), tipo: 'text' },
            { key: 'metodo', label: t('Método', 'Method'), tipo: 'text', help: t('contraseña · llave SSH', 'password · SSH key') },
            { key: 'password', label: t('Contraseña o ruta de la llave', 'Password or key path'), tipo: 'password' },
            { key: 'passphrase_llave', label: t('Passphrase de la llave', 'Key passphrase'), tipo: 'password' },
            { key: 'notas', label: t('Notas', 'Notes'), tipo: 'textarea' },
        ],
    },
    {
        id: 'documento_fisico',
        label: t('Documento / ubicación física', 'Document / physical location'),
        icon: 'fa-box-archive',
        descripcion: t('Dónde está un documento o bien y cómo acceder a él.', 'Where a document or asset is and how to access it.'),
        categoria: 'Propiedades y Patrimonio',
        identidad: 'tipo_documento',
        campos: [
            { key: 'tipo_documento', label: t('Tipo de documento o bien', 'Type of document or asset'), tipo: 'text', help: t('Escritura, testamento, acta…', 'Deed, will, certificate…') },
            { key: 'descripcion', label: t('Descripción', 'Description'), tipo: 'textarea' },
            { key: 'ubicacion_fisica', label: t('Ubicación física', 'Physical location'), tipo: 'text', help: t('Caja fuerte, caja de seguridad bancaria…', 'Safe, bank safe-deposit box…') },
            { key: 'resguardante', label: t('Persona que lo resguarda', 'Person who keeps it'), tipo: 'text' },
            { key: 'combinacion', label: t('Combinación / llave', 'Combination / key'), tipo: 'password' },
            { key: 'notas', label: t('Notas', 'Notes'), tipo: 'textarea' },
        ],
    },
    {
        id: 'nota_segura',
        label: t('Nota segura / instrucciones', 'Secure note / instructions'),
        icon: 'fa-note-sticky',
        descripcion: t('Texto libre: instrucciones de sucesión, contactos clave, etc.', 'Free text: succession instructions, key contacts, etc.'),
        categoria: 'Instrucciones de Sucesión',
        identidad: 'titulo',
        campos: [
            { key: 'titulo', label: t('Título', 'Title'), tipo: 'text' },
            { key: 'cuerpo', label: t('Contenido', 'Content'), tipo: 'textarea' },
        ],
    },
];

export function plantillaById(id: string | null | undefined): Plantilla | undefined {
    if (!id) return undefined;
    return plantillas().find((p) => p.id === id);
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
        const valor = (v ?? '').trim();
        if (valor) limpio[k] = valor;
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
        throw new Error(t('El activo no tiene el formato de una plantilla de credenciales.', "The asset isn't in the credential template format."));
    }
    return {
        b152_plantilla: String(raw.b152_plantilla),
        version: CRED_VERSION,
        creado_en: raw.creado_en ?? new Date().toISOString(),
        actualizado_en: raw.actualizado_en ?? raw.creado_en ?? new Date().toISOString(),
        campos: (raw.campos ?? {}) as Record<string, string>,
    };
}
