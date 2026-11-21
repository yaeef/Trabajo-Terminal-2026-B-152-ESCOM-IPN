// 1:1 con backend/app/schemas/suscripcion.py

import { locale, t } from '../i18n';

export interface Plan {
    id: number;
    nombre: string;
    costo_anual: number;  // único ciclo de facturación; 0 = gratuito
    costo_reserva: number;  // año de reserva; 0 = el plan no lo ofrece
    max_almacenamiento_mb: number;
    max_bovedas: number;
    max_custodios: number;
    max_archivos: number | null;  // archivos subidos (sin plantillas); null = sin límite
}

export interface UsoActual {
    bovedas: number;
    custodios: number;
    almacenamiento_bytes: number;
    archivos: number;
}

/** Qué cubre hoy: Gratuito, el año pagado, la gracia tras vencer (con año
 *  de reserva) o el año de reserva. */
export type Cobertura = 'gratuito' | 'pago' | 'gracia' | 'reserva';

export interface ReservaEstado {
    estado: 'disponible' | 'activa';
    cubre_desde: string | null;
    cubre_hasta: string | null;
}

export interface ImpagoEstado {
    estado: 'abierto' | 'pausado';  // pausado: el DMS no está activo, no se borra nada
    inicio: string;
    recorte_en: string;
    id_boveda_conservar: number | null;
    excesos: string[];
}

export interface PlanActual {
    plan: Plan;
    fecha_inicio: string;
    fecha_fin: string | null;     // fin del periodo que cubre hoy (null = sin caducidad)
    cancelada_en: string | null;  // no quiere renovar: sin avisos de renovación
    uso: UsoActual;
    cobertura: Cobertura;
    pagado_hasta: string | null;  // fin del último año pagado (incluye una renovación)
    puede_renovar: boolean;
    renovable_desde: string | null;
    reserva: ReservaEstado | null;
    impago: ImpagoEstado | null;
}

/** Un año del plan, el año de reserva, o ambos en una sola orden. */
export interface Compra {
    plan_id: number;
    incluye_plan: boolean;
    incluye_reserva: boolean;
}

const MB = 1024 ** 2;

/** Nombre a mostrar de un plan (el backend solo tiene 'Gratuito' y 'Premium'). */
export const nombrePlan = (nombre: string): string => (nombre === 'Gratuito' ? t('Gratuito', 'Free') : nombre);

/** Cuota del plan en bytes. */
export const cuotaPlanBytes = (plan: Plan): number => plan.max_almacenamiento_mb * MB;

/** 512 → "512 MB"; 51200 → "50 GB". */
export const tamanoPlan = (mb: number): string =>
    mb >= 1024 ? `${Number((mb / 1024).toFixed(1))} GB` : `${mb} MB`;

/** Fecha de una columna DATE ('AAAA-MM-DD') como dd/mm/aaaa (mm/dd/aaaa en inglés). `new Date(iso)`
 *  la tomaría como medianoche UTC y en México mostraría el día anterior. */
export const fechaCorta = (iso: string): string => {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d).toLocaleDateString(locale());
};

/** ¿El uso actual cabe dentro de los límites de `plan`? */
export function planAdmiteUso(plan: Plan, uso: UsoActual): boolean {
    return (
        uso.bovedas <= plan.max_bovedas &&
        uso.custodios <= plan.max_custodios &&
        uso.almacenamiento_bytes <= cuotaPlanBytes(plan) &&
        (plan.max_archivos === null || uso.archivos <= plan.max_archivos)
    );
}

/** Motivos por los que `plan` no admite el uso actual (para el tooltip). */
export function motivosExceso(plan: Plan, uso: UsoActual): string[] {
    const m: string[] = [];
    if (uso.bovedas > plan.max_bovedas)
        m.push(t(`tienes ${uso.bovedas} bóvedas (máx. ${plan.max_bovedas})`, `you have ${uso.bovedas} vaults (max. ${plan.max_bovedas})`));
    if (uso.custodios > plan.max_custodios)
        m.push(t(`tienes ${uso.custodios} custodios (máx. ${plan.max_custodios})`, `you have ${uso.custodios} custodians (max. ${plan.max_custodios})`));
    if (uso.almacenamiento_bytes > cuotaPlanBytes(plan))
        m.push(t(`usas más de ${tamanoPlan(plan.max_almacenamiento_mb)}`, `you use more than ${tamanoPlan(plan.max_almacenamiento_mb)}`));
    if (plan.max_archivos !== null && uso.archivos > plan.max_archivos)
        m.push(t(`tienes ${uso.archivos} archivos (máx. ${plan.max_archivos})`, `you have ${uso.archivos} files (max. ${plan.max_archivos})`));
    return m;
}
