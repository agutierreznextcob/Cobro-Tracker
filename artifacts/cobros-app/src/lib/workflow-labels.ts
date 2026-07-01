import type {
  WorkflowStepAccionTipo,
  WorkflowTriggerTipo,
} from "@workspace/api-client-react";

export const ACCION_LABELS: Record<string, string> = {
  enviar_email: "Enviar email",
  enviar_whatsapp: "Enviar WhatsApp",
  crear_tarea: "Crear tarea",
  notificar_admin: "Notificar al equipo",
  aplicar_descuento: "Aplicar descuento",
  cambiar_estado: "Cambiar estado",
  enviar_comprobante: "Enviar comprobante",
  enviar_encuesta: "Enviar encuesta",
};

export function accionLabel(tipo: string): string {
  return ACCION_LABELS[tipo] ?? tipo;
}

export const TRIGGER_LABELS: Record<string, string> = {
  cobro_creado: "Al crear el cobro",
  proximo_vencer: "Próximo a vencer",
  vencido: "Al vencer",
  dias_mora: "Días de mora",
  no_pagado_despues: "No pagado después de",
  marcado_parcial: "Marcado como parcial",
  email_no_abierto: "Email no abierto",
};

export function triggerLabel(tipo: string): string {
  return TRIGGER_LABELS[tipo] ?? tipo;
}

export const ACCION_TIPOS: WorkflowStepAccionTipo[] = [
  "enviar_email",
  "enviar_whatsapp",
  "crear_tarea",
  "notificar_admin",
  "aplicar_descuento",
  "cambiar_estado",
  "enviar_comprobante",
  "enviar_encuesta",
];

export const TRIGGER_TIPOS: WorkflowTriggerTipo[] = [
  "cobro_creado",
  "proximo_vencer",
  "vencido",
  "dias_mora",
  "no_pagado_despues",
  "marcado_parcial",
  "email_no_abierto",
];
