import { IVA_RATE } from "./flow-subscriptions";

// ---------------------------------------------------------------------------
// Planes de suscripción de la plataforma.
//
// Precios en CLP, IVA (19%) incluido en `total` (neto + iva = total). Los
// montos que se cobran vía Reveniu siempre son el total IVA incluido.
//
// El plan "pro" existe solo como concepto de UI ("Próximamente" + lista de
// espera); no es contratable y NO forma parte del enum de la BD.
// ---------------------------------------------------------------------------

export type PlanId = "starter" | "nextcob";

// Funcionalidades gateadas por plan. Todo lo que no aparece aquí es común a
// todos los planes (cobros, clientes, links de pago, abonos, recordatorios
// manuales, dashboard y aging básicos, exportación básica).
export type PlanFeature =
  | "workflows" // workflows inteligentes / automatización
  | "scoring_predictivo" // probabilidad de pago, fecha estimada, promesas
  | "asistente_ia" // chat asistente IA dentro de la app
  | "recordatorios_automaticos" // envío automático programado de recordatorios
  | "informes_avanzados" // rendimiento de equipo, métricas de gestión, satisfacción
  | "equipo"; // invitar a más usuarios que los incluidos

export interface PlanDef {
  id: PlanId;
  nombre: string;
  neto: number;
  iva: number;
  total: number;
  usuariosIncluidos: number;
  // Puede sumar asientos extra por sobre los incluidos (solo NextCob).
  permiteUsuariosExtra: boolean;
  features: ReadonlySet<PlanFeature>;
}

const STARTER_NETO = 14_990;
const STARTER_IVA = Math.round(STARTER_NETO * IVA_RATE); // 2.848
const NEXTCOB_NETO = 24_990;
const NEXTCOB_IVA = Math.round(NEXTCOB_NETO * IVA_RATE); // 4.748

export const PLANES: Record<PlanId, PlanDef> = {
  starter: {
    id: "starter",
    nombre: "Starter",
    neto: STARTER_NETO,
    iva: STARTER_IVA,
    total: STARTER_NETO + STARTER_IVA, // 17.838
    usuariosIncluidos: 1,
    permiteUsuariosExtra: false,
    features: new Set<PlanFeature>(), // solo funciones esenciales
  },
  nextcob: {
    id: "nextcob",
    nombre: "NextCob",
    neto: NEXTCOB_NETO,
    iva: NEXTCOB_IVA,
    total: NEXTCOB_NETO + NEXTCOB_IVA, // 29.738
    usuariosIncluidos: 2,
    permiteUsuariosExtra: true,
    features: new Set<PlanFeature>([
      "workflows",
      "scoring_predictivo",
      "asistente_ia",
      "recordatorios_automaticos",
      "informes_avanzados",
      "equipo",
    ]),
  },
};

// ---------------------------------------------------------------------------
// Packs de usuarios adicionales.
//
// Los asientos extra se contratan por PACKS con descuento por volumen (ya no
// se cobra por asiento individual automáticamente). Los packs se ACUMULAN
// (p. ej. 2× pack5 = 10 usuarios extra) y se suman al cobro mensual base.
// Solo disponibles en planes con permiteUsuariosExtra (NextCob).
// ---------------------------------------------------------------------------

export type PackId = "individual" | "pack5" | "pack10" | "pack20";

export interface PackDef {
  id: PackId;
  nombre: string;
  usuarios: number;
  neto: number;
  iva: number;
  total: number;
  // Precio unitario por usuario (total IVA incl. / usuarios), redondeado.
  porUsuario: number;
  // % de ahorro vs comprar el mismo número de packs individuales.
  ahorroPct: number;
  etiqueta: string | null;
}

function mkPack(id: PackId, nombre: string, usuarios: number, neto: number, ahorroPct: number, etiqueta: string | null): PackDef {
  const iva = Math.round(neto * IVA_RATE);
  const total = neto + iva;
  return { id, nombre, usuarios, neto, iva, total, porUsuario: Math.round(neto / usuarios), ahorroPct, etiqueta };
}

export const PACKS_USUARIOS: Record<PackId, PackDef> = {
  individual: mkPack("individual", "Pack Individual", 1, 9_990, 0, null),
  pack5: mkPack("pack5", "Pack 5 usuarios", 5, 39_990, 20, "Buen precio"),
  pack10: mkPack("pack10", "Pack 10 usuarios", 10, 69_990, 30, "⭐ Más popular"),
  pack20: mkPack("pack20", "Pack 20 usuarios", 20, 119_990, 40, "💎 Mejor valor"),
};

export const PACK_IDS: readonly PackId[] = ["individual", "pack5", "pack10", "pack20"];

// Cantidades de packs contratados por el dueño de la org: {pack10: 1, ...}.
export type PacksUsuarios = Partial<Record<PackId, number>>;

export function normalizarPacks(raw: unknown): PacksUsuarios {
  const out: PacksUsuarios = {};
  if (raw && typeof raw === "object") {
    for (const id of PACK_IDS) {
      const v = (raw as Record<string, unknown>)[id];
      if (typeof v === "number" && Number.isInteger(v) && v > 0) out[id] = v;
    }
  }
  return out;
}

// Usuarios extra que aportan los packs contratados.
export function cupoDePacks(packs: PacksUsuarios): number {
  return PACK_IDS.reduce((acc, id) => acc + (packs[id] ?? 0) * PACKS_USUARIOS[id].usuarios, 0);
}

// Costo mensual total de los packs (IVA incluido), y desglose neto/IVA.
export function costoDePacks(packs: PacksUsuarios): { neto: number; iva: number; total: number } {
  let neto = 0;
  let iva = 0;
  for (const id of PACK_IDS) {
    const n = packs[id] ?? 0;
    neto += n * PACKS_USUARIOS[id].neto;
    iva += n * PACKS_USUARIOS[id].iva;
  }
  return { neto, iva, total: neto + iva };
}

// Plan efectivo de un usuario: durante el trial (y para admins/demo) todos
// operan con el nivel NextCob completo; con suscripción, el plan contratado
// (NULL histórico = nextcob, los suscriptores previos a los planes).
export function planEfectivo(row: {
  subscriptionStatus: "prueba" | "activa" | "vencida" | "cancelada";
  plan: PlanId | null;
  role?: "user" | "admin";
  esDemo?: boolean;
}): PlanId {
  if (row.role === "admin" || row.esDemo) return "nextcob";
  if (row.subscriptionStatus === "prueba") return "nextcob";
  return row.plan ?? "nextcob";
}

export function planIncluye(plan: PlanId, feature: PlanFeature): boolean {
  return PLANES[plan].features.has(feature);
}
