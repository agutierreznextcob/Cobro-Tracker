export const TIPO_DOCUMENTO_VALUES = [
  // --- Documentos SII formales ---
  "boleta_manual",           // 35 Boleta Manual
  "boleta_electronica",      // 39 Boleta Electrónica
  "boleta_electronica_stock",// 39 Boleta Electrónica Rebaja Stock
  "factura_electronica",     // 33 Factura Electrónica
  "factura_electronica_stock", // 33 Factura Electrónica Rebaja Stock
  "factura_no_afecta",       // 34 Factura NO Afecta o Exenta Electrónica
  "liquidacion_factura",     // 43 Liquidación Factura
  "nota_credito",            // 61 Nota de Crédito Electrónica
  "nota_credito_exenta",     // 61 Nota de Crédito Exenta Electrónica
  "nota_credito_stock",      // 61 Nota de Crédito Electrónica Aumenta Stock
  "nota_debito",             // 56 Nota de Débito Electrónica
  "nota_debito_exenta",      // 56 Nota de Débito Exenta Electrónica
  "vale_comprobante",        // 48 Vales Comprobante de Pago RS
  // --- Sin documento formal ---
  "sin_documento",
] as const;

export type TipoDocumento = (typeof TIPO_DOCUMENTO_VALUES)[number];

export const TIPO_DOCUMENTO_LABELS: Record<TipoDocumento, string> = {
  boleta_manual:              "35 · Boleta Manual",
  boleta_electronica:         "39 · Boleta Electrónica",
  boleta_electronica_stock:   "39 · Boleta Electrónica Rebaja Stock",
  factura_electronica:        "33 · Factura Electrónica",
  factura_electronica_stock:  "33 · Factura Electrónica Rebaja Stock",
  factura_no_afecta:          "34 · Factura NO Afecta o Exenta Electrónica",
  liquidacion_factura:        "43 · Liquidación Factura",
  nota_credito:               "61 · Nota de Crédito Electrónica",
  nota_credito_exenta:        "61 · Nota de Crédito Exenta Electrónica",
  nota_credito_stock:         "61 · Nota de Crédito Electrónica Aumenta Stock",
  nota_debito:                "56 · Nota de Débito Electrónica",
  nota_debito_exenta:         "56 · Nota de Débito Exenta Electrónica",
  vale_comprobante:           "48 · Vales Comprobante de Pago RS",
  sin_documento:              "Sin documento / Cobro informal",
};

// Short label for compact surfaces (tables, badges).
export const TIPO_DOCUMENTO_LABELS_CORTOS: Record<TipoDocumento, string> = {
  boleta_manual:             "Boleta Manual",
  boleta_electronica:        "Boleta Electrónica",
  boleta_electronica_stock:  "Boleta Elect. Stock",
  factura_electronica:       "Factura Electrónica",
  factura_electronica_stock: "Factura Elect. Stock",
  factura_no_afecta:         "Factura Exenta",
  liquidacion_factura:       "Liquidación Factura",
  nota_credito:              "Nota Crédito",
  nota_credito_exenta:       "Nota Crédito Exenta",
  nota_credito_stock:        "Nota Crédito Stock",
  nota_debito:               "Nota Débito",
  nota_debito_exenta:        "Nota Débito Exenta",
  vale_comprobante:          "Vale Comprobante",
  sin_documento:             "Sin documento",
};

// Grupos para el selector
export const TIPO_DOCUMENTO_GRUPOS = [
  {
    label: "Boletas",
    values: ["boleta_manual", "boleta_electronica", "boleta_electronica_stock"] as TipoDocumento[],
  },
  {
    label: "Facturas",
    values: ["factura_electronica", "factura_electronica_stock", "factura_no_afecta", "liquidacion_factura"] as TipoDocumento[],
  },
  {
    label: "Notas",
    values: ["nota_credito", "nota_credito_exenta", "nota_credito_stock", "nota_debito", "nota_debito_exenta"] as TipoDocumento[],
  },
  {
    label: "Otros",
    values: ["vale_comprobante", "sin_documento"] as TipoDocumento[],
  },
] as const;

export const TIPO_DOCUMENTO_OPTIONS = TIPO_DOCUMENTO_VALUES.map((value) => ({
  value,
  label: TIPO_DOCUMENTO_LABELS[value],
}));

// Documentos que llevan IVA (afectos): boletas y facturas afectas
export function tipoDocumentoPermiteIva(tipo: TipoDocumento): boolean {
  return (
    tipo === "boleta_manual" ||
    tipo === "boleta_electronica" ||
    tipo === "boleta_electronica_stock" ||
    tipo === "factura_electronica" ||
    tipo === "factura_electronica_stock" ||
    tipo === "nota_debito"
  );
}

export function tipoDocumentoLabel(tipo: string | null | undefined): string {
  if (tipo && tipo in TIPO_DOCUMENTO_LABELS) {
    return TIPO_DOCUMENTO_LABELS[tipo as TipoDocumento];
  }
  return TIPO_DOCUMENTO_LABELS.sin_documento;
}

export function tipoDocumentoLabelCorto(tipo: string | null | undefined): string {
  if (tipo && tipo in TIPO_DOCUMENTO_LABELS_CORTOS) {
    return TIPO_DOCUMENTO_LABELS_CORTOS[tipo as TipoDocumento];
  }
  return TIPO_DOCUMENTO_LABELS_CORTOS.sin_documento;
}
