// 1:1 con backend/app/schemas/subscription.py

export interface Plan {
    id: number;
    nombre: string;
    costo_anual: number;  // único ciclo de facturación; 0 = gratuito
    max_almacenamiento_gb: number;
    max_bovedas: number;
    max_custodios: number;
}

export interface UsoActual {
    bovedas: number;
    custodios: number;
    almacenamiento_bytes: number;
}

export interface PlanActual {
    plan: Plan;
    fecha_inicio: string;
    fecha_fin: string | null;     // día en que vence (null = sin caducidad)
    cancelada_en: string | null;  // canceló: al vencer pasa a Gratuito
    uso: UsoActual;
}

const GB = 1024 ** 3;

/** Fecha de una columna DATE ('AAAA-MM-DD') como dd/mm/aaaa. `new Date(iso)`
 *  la tomaría como medianoche UTC y en México mostraría el día anterior. */
export const fechaCorta = (iso: string): string => {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d).toLocaleDateString('es-MX');
};

/** ¿El uso actual cabe dentro de los límites de `plan`? */
export function planAdmiteUso(plan: Plan, uso: UsoActual): boolean {
    return (
        uso.bovedas <= plan.max_bovedas &&
        uso.custodios <= plan.max_custodios &&
        uso.almacenamiento_bytes <= plan.max_almacenamiento_gb * GB
    );
}

/** Motivos por los que `plan` no admite el uso actual (para el tooltip). */
export function motivosExceso(plan: Plan, uso: UsoActual): string[] {
    const m: string[] = [];
    if (uso.bovedas > plan.max_bovedas) m.push(`tienes ${uso.bovedas} bóvedas (máx. ${plan.max_bovedas})`);
    if (uso.custodios > plan.max_custodios) m.push(`tienes ${uso.custodios} custodios (máx. ${plan.max_custodios})`);
    if (uso.almacenamiento_bytes > plan.max_almacenamiento_gb * GB)
        m.push(`usas más de ${plan.max_almacenamiento_gb} GB`);
    return m;
}
