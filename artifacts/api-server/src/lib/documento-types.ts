import type { Empresa } from "@workspace/api-zod";
export type DocumentoPdf = {
  tipo: "COTIZACIÓN" | "COBRO";
  numero: string; estado: string; emision: string; vencimiento: string | null;
  moneda: string; decimales: number; formatoFecha: string;
  empresa: Empresa; logo: Buffer | null;
  receptor: { nombre: string; rut: string; giro: string; direccion: string; email: string };
  items: { cantidad: number; descripcion: string; precioUnitario: number; descuentoPorcentaje: number; subtotal: number }[];
  subtotal: number; descuentoGlobal: number; porcentajeIva: number; montoIva: number; total: number;
  formaPago: string; tiempoEntrega: string; validezDias: number | null; notas: string;
  equivalencia: string | null;
};
