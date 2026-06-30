export const TIPO_DOCUMENTO_VALUES = [
  "factura_afecta",
  "factura_exenta",
  "boleta_afecta",
  "boleta_exenta",
  "sin_documento",
] as const;

export type TipoDocumento = (typeof TIPO_DOCUMENTO_VALUES)[number];

export const TIPO_DOCUMENTO_LABELS: Record<TipoDocumento, string> = {
  factura_afecta: "Factura electrónica afecta",
  factura_exenta: "Factura electrónica exenta",
  boleta_afecta: "Boleta electrónica afecta",
  boleta_exenta: "Boleta electrónica exenta",
  sin_documento: "Sin documento / Cobro informal",
};

// Short label for compact surfaces (tables, badges).
export const TIPO_DOCUMENTO_LABELS_CORTOS: Record<TipoDocumento, string> = {
  factura_afecta: "Factura afecta",
  factura_exenta: "Factura exenta",
  boleta_afecta: "Boleta afecta",
  boleta_exenta: "Boleta exenta",
  sin_documento: "Sin documento",
};

export const TIPO_DOCUMENTO_OPTIONS = TIPO_DOCUMENTO_VALUES.map((value) => ({
  value,
  label: TIPO_DOCUMENTO_LABELS[value],
}));

// Only "afecta" electronic documents may carry IVA.
export function tipoDocumentoPermiteIva(tipo: TipoDocumento): boolean {
  return tipo === "factura_afecta" || tipo === "boleta_afecta";
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
