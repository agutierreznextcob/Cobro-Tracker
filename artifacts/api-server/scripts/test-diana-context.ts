import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DIANA_PRODUCT_CONTEXT } from "../src/lib/diana-product-context";

test("Diana knows all current modules and distinctive features", () => {
  for (const name of ["Ventas", "Cobros", "Cotizaciones", "Inventario", "pistola lectora",
    "calculadora de precios", "Locales y Bodegas", "Compras", "Proveedores", "Clientes",
    "/informes/ventas", "/informes/compras", "/informes/inventario", "Satisfacción",
    "Google Reviews", "Configuración", "Perfil de empresa", "Plantillas PDF", "Indicadores económicos"]) {
    assert.ok(DIANA_PRODUCT_CONTEXT.includes(name), `Missing product knowledge: ${name}`);
  }
});
test("Knowledge distinguishes availability, data access and honest product limits", () => {
  for (const rule of ["verifica SIEMPRE", "prioridad frente a respuestas antiguas", "falta de datos o permisos",
    "no concluyas que no existe", "NO otorga acceso", "TODAS las calificaciones", "no reseñas publicadas",
    "no son cotizaciones bursátiles segundo a segundo"]) {
    assert.ok(DIANA_PRODUCT_CONTEXT.includes(rule), `Missing guardrail: ${rule}`);
  }
});
test("Public and authenticated system prompts both inject the same catalogue", () => {
  for (const name of ["ai", "public-chat"]) {
    const source = readFileSync(new URL(`../src/routes/${name}.ts`, import.meta.url), "utf8");
    assert.match(source, /import \{ DIANA_PRODUCT_CONTEXT \} from "\.\.\/lib\/diana-product-context"/);
    assert.ok(source.includes("${DIANA_PRODUCT_CONTEXT}"));
    assert.match(source, /role: "system", content: systemPrompt/);
  }
});
