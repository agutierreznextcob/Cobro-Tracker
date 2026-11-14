import assert from "node:assert/strict";
import { CreateCobroBody, UpdateCobroBody, CreateCobroRecurrenteBody, CreateCobrosMasivosBody, GetCobroResponse } from "@workspace/api-zod";

const tipos = [
  "factura_afecta", "factura_exenta", "boleta_afecta", "boleta_exenta",
  "boleta_manual", "boleta_electronica", "boleta_electronica_stock",
  "factura_electronica", "factura_electronica_stock", "factura_no_afecta",
  "liquidacion_factura", "nota_credito", "nota_credito_exenta",
  "nota_credito_stock", "nota_debito", "nota_debito_exenta",
  "vale_comprobante", "sin_documento",
];
for (const tipoDocumento of tipos) {
  const base = {
    monto: 1500, descripcion: "Prueba de tipo de documento", tipoDocumento,
    automatizacion: "ninguna", canalesIniciales: [],
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
  };
  assert.equal(CreateCobroBody.parse(base).tipoDocumento, tipoDocumento);
  assert.equal(UpdateCobroBody.parse({ tipoDocumento }).tipoDocumento, tipoDocumento);
  assert.equal(CreateCobroRecurrenteBody.parse({
    ...base, clienteId: 1, frecuencia: "mensual", fechaInicio: "2026-11-14",
  }).tipoDocumento, tipoDocumento);
  assert.equal(CreateCobrosMasivosBody.parse({
    ...base, clienteIds: [1],
  }).tipoDocumento, tipoDocumento);
  assert.equal(GetCobroResponse.shape.tipoDocumento.parse(tipoDocumento), tipoDocumento);
}
for (const schema of [CreateCobroBody, UpdateCobroBody, GetCobroResponse]) {
  assert.equal(schema.shape.tipoDocumento.safeParse("documento_invalido").success, false);
}
assert.equal(CreateCobroBody.safeParse({
  monto: -1, descripcion: "Inválido", tipoDocumento: "vale_comprobante",
}).success, false);
console.info("OK: los 18 tipos se aceptan en creación, edición, recurrentes, masivos y respuestas.");
