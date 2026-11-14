import assert from "node:assert/strict";
import { CreateCobroBody, UpdateCobroBody, CreateCobroRecurrenteBody } from "@workspace/api-zod";

const tipoDocumento = "vale_comprobante";
assert.equal(
  CreateCobroBody.parse({ monto: 1500, descripcion: "Validación de comprobante", tipoDocumento }).tipoDocumento,
  tipoDocumento,
);
assert.equal(UpdateCobroBody.parse({ tipoDocumento }).tipoDocumento, tipoDocumento);
assert.equal(CreateCobroRecurrenteBody.parse({
  monto: 1500, descripcion: "Comprobante recurrente", tipoDocumento,
  automatizacion: "ninguna", canalesIniciales: [],
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  clienteId: 1, frecuencia: "mensual", fechaInicio: "2026-11-14",
}).tipoDocumento, tipoDocumento);

for (const schema of [CreateCobroBody, UpdateCobroBody]) {
  for (const value of ["factura_afecta", "factura_exenta", "boleta_afecta", "boleta_exenta", "sin_documento"]) {
    assert.equal(schema.shape.tipoDocumento.parse(value), value);
  }
  assert.equal(schema.shape.tipoDocumento.safeParse("documento_invalido").success, false);
}
assert.equal(CreateCobroBody.safeParse({ monto: -1, descripcion: "Inválido", tipoDocumento }).success, false);
console.info("OK: vale_comprobante aceptado; tipos anteriores y validaciones preservados.");
