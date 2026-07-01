import type { WorkflowCondiciones } from "@workspace/db";
import type { WorkflowStepConfig } from "@workspace/db";

// Predefined collection-workflow templates. Each is seeded once per organization
// on demand (or offered as a starting point). The AI "sugerencia" maps a client's
// score category to the most appropriate template key.

export type TriggerTipo =
  | "cobro_creado"
  | "proximo_vencer"
  | "vencido"
  | "dias_mora"
  | "no_pagado_despues"
  | "marcado_parcial"
  | "email_no_abierto";

export type AccionTipo =
  | "enviar_email"
  | "enviar_whatsapp"
  | "crear_tarea"
  | "notificar_admin"
  | "aplicar_descuento"
  | "cambiar_estado"
  | "enviar_comprobante"
  | "enviar_encuesta";

export interface PlantillaStep {
  orden: number;
  delayDias: number;
  accionTipo: AccionTipo;
  config: WorkflowStepConfig;
}

export interface WorkflowPlantilla {
  key: string;
  nombre: string;
  descripcion: string;
  triggerTipo: TriggerTipo;
  triggerDias: number;
  condiciones: WorkflowCondiciones | null;
  steps: PlantillaStep[];
}

const emailCfg = (asunto: string, mensaje: string): WorkflowStepConfig => ({
  asunto,
  mensaje,
});

export const WORKFLOW_PLANTILLAS: WorkflowPlantilla[] = [
  {
    key: "estandar",
    nombre: "Cobranza estándar",
    descripcion:
      "Secuencia equilibrada de recordatorios para la mayoría de los clientes: email al vencer, WhatsApp de seguimiento y una tarea de llamada si no paga.",
    triggerTipo: "vencido",
    triggerDias: 0,
    condiciones: null,
    steps: [
      {
        orden: 0,
        delayDias: 0,
        accionTipo: "enviar_email",
        config: emailCfg(
          "Recordatorio de pago pendiente",
          "Queremos recordarte amablemente que tu cobro venció hoy. Puedes regularizarlo cuando gustes; si ya lo pagaste, ignora este mensaje.",
        ),
      },
      {
        orden: 1,
        delayDias: 3,
        accionTipo: "enviar_whatsapp",
        config: {
          mensaje:
            "Hola 👋 Tienes un cobro pendiente que venció hace unos días. ¿Podemos ayudarte a regularizarlo?",
        },
      },
      {
        orden: 2,
        delayDias: 7,
        accionTipo: "enviar_email",
        config: emailCfg(
          "Tu cobro sigue pendiente",
          "Tu cobro lleva una semana vencido. Te agradeceremos regularizar el pago a la brevedad para evitar gestiones adicionales.",
        ),
      },
      {
        orden: 3,
        delayDias: 10,
        accionTipo: "crear_tarea",
        config: { tareaTitulo: "Llamar al cliente por cobro vencido (10 días)" },
      },
    ],
  },
  {
    key: "intensiva",
    nombre: "Cobranza intensiva",
    descripcion:
      "Secuencia acelerada con contactos frecuentes y aviso al administrador. Ideal para clientes que suelen atrasarse.",
    triggerTipo: "vencido",
    triggerDias: 0,
    condiciones: null,
    steps: [
      {
        orden: 0,
        delayDias: 0,
        accionTipo: "enviar_email",
        config: emailCfg(
          "Cobro vencido — acción requerida",
          "Tu cobro ha vencido. Te pedimos regularizar el pago hoy mismo para mantener tu cuenta al día.",
        ),
      },
      {
        orden: 1,
        delayDias: 1,
        accionTipo: "enviar_whatsapp",
        config: {
          mensaje:
            "Hola, tu cobro está vencido. Por favor regulariza el pago a la brevedad. Estamos disponibles para ayudarte.",
        },
      },
      {
        orden: 2,
        delayDias: 3,
        accionTipo: "enviar_email",
        config: emailCfg(
          "Segundo aviso de cobro vencido",
          "Aún no registramos tu pago. Regulariza tu cobro para evitar gestiones de cobranza adicionales.",
        ),
      },
      {
        orden: 3,
        delayDias: 5,
        accionTipo: "notificar_admin",
        config: {},
      },
      {
        orden: 4,
        delayDias: 7,
        accionTipo: "crear_tarea",
        config: { tareaTitulo: "Gestión telefónica de cobranza (cobro intensivo)" },
      },
    ],
  },
  {
    key: "suave",
    nombre: "Cobranza suave",
    descripcion:
      "Recordatorios anticipados y cordiales, comenzando antes del vencimiento. Pensada para relaciones que priorizan el buen trato.",
    triggerTipo: "proximo_vencer",
    triggerDias: 3,
    condiciones: null,
    steps: [
      {
        orden: 0,
        delayDias: 0,
        accionTipo: "enviar_email",
        config: emailCfg(
          "Tu cobro vence pronto",
          "Solo un recordatorio amistoso: tu cobro vence en unos días. Cuando quieras puedes dejarlo pagado.",
        ),
      },
      {
        orden: 1,
        delayDias: 5,
        accionTipo: "enviar_email",
        config: emailCfg(
          "Recordatorio de pago",
          "Tu cobro venció recientemente. Sabemos que a veces se pasa por alto, así que te dejamos este recordatorio cordial.",
        ),
      },
      {
        orden: 2,
        delayDias: 10,
        accionTipo: "enviar_whatsapp",
        config: {
          mensaje:
            "Hola 😊 Pasamos a recordarte tu cobro pendiente. Cualquier duda, con gusto te ayudamos.",
        },
      },
    ],
  },
  {
    key: "vip",
    nombre: "Cliente VIP",
    descripcion:
      "Trato preferente y personalizado para tus mejores pagadores: contacto tardío, cordial y con seguimiento humano.",
    triggerTipo: "vencido",
    triggerDias: 0,
    condiciones: { scores: ["excelente", "bueno"] },
    steps: [
      {
        orden: 0,
        delayDias: 2,
        accionTipo: "enviar_email",
        config: emailCfg(
          "Un recordatorio para ti",
          "Valoramos mucho tu preferencia. Solo queríamos recordarte con cariño que tienes un cobro pendiente; sin apuros.",
        ),
      },
      {
        orden: 1,
        delayDias: 7,
        accionTipo: "crear_tarea",
        config: { tareaTitulo: "Contactar personalmente a cliente VIP" },
      },
    ],
  },
  {
    key: "alto_riesgo",
    nombre: "Alto riesgo",
    descripcion:
      "Secuencia firme y rápida para clientes con historial de riesgo: contacto inmediato, aviso al administrador, incentivo de descuento y evaluación de acciones.",
    triggerTipo: "dias_mora",
    triggerDias: 1,
    condiciones: { scores: ["riesgoso", "critico"] },
    steps: [
      {
        orden: 0,
        delayDias: 0,
        accionTipo: "enviar_email",
        config: emailCfg(
          "Cobro vencido — regulariza tu pago",
          "Tu cobro se encuentra vencido. Es importante regularizarlo cuanto antes para evitar gestiones de cobranza formales.",
        ),
      },
      {
        orden: 1,
        delayDias: 1,
        accionTipo: "enviar_whatsapp",
        config: {
          mensaje:
            "Hola, tu cobro está vencido y requiere tu atención. Por favor contáctanos hoy para acordar el pago.",
        },
      },
      {
        orden: 2,
        delayDias: 2,
        accionTipo: "notificar_admin",
        config: {},
      },
      {
        orden: 3,
        delayDias: 3,
        accionTipo: "aplicar_descuento",
        config: { descuentoTipo: "porcentaje", descuentoValor: 10 },
      },
      {
        orden: 4,
        delayDias: 5,
        accionTipo: "crear_tarea",
        config: { tareaTitulo: "Evaluar acciones de cobranza para cliente en mora" },
      },
    ],
  },
];

export function getPlantilla(key: string): WorkflowPlantilla | undefined {
  return WORKFLOW_PLANTILLAS.find((p) => p.key === key);
}

// Maps a client's AI score category to the recommended template key.
export function plantillaKeyForScore(categoria: string): string {
  switch (categoria) {
    case "excelente":
      return "vip";
    case "bueno":
      return "estandar";
    case "regular":
      return "intensiva";
    case "riesgoso":
    case "critico":
      return "alto_riesgo";
    default:
      return "estandar";
  }
}
