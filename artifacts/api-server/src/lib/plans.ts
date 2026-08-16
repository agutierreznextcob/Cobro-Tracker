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
