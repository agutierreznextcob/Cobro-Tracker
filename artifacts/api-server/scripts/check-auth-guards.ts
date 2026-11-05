/**
 * Chequeo ESTÁTICO de guardias de autenticación mal ubicados.
 *
 * No requiere el servidor levantado (complementa scripts/e2e-public-routes.ts).
 *
 * Regla: en la cadena compartida /api (src/routes/index.ts), un
 * `router.use(<middleware>)` SIN path ("blanket guard") dentro de un router
 * montado captura TODO el tráfico que llegue después de su punto de montaje.
 * Eso rompe rutas públicas (portal, leads, chat público, webhooks, encuestas)
 * si el router con blanket guard se monta antes que ellas, o si un router
 * nuevo agrega un blanket guard sin estar en la lista blanca.
 *
 * Este script falla (exit 1) si:
 *  1. Un router montado en routes/index.ts contiene un `.use()` sin path y su
 *     archivo NO está en la lista blanca ALLOWED_BLANKET_GUARD_FILES.
 *  2. Un router de la lista blanca (con blanket guard) está montado ANTES que
 *     algún router con rutas públicas (PUBLIC_ROUTER_FILES).
 *  3. La lista blanca menciona un archivo que ya no tiene blanket guard
 *     (lista blanca obsoleta — mantenerla honesta).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findUnscopedUses } from "./auth-guard-analysis";

const routesDir = join(dirname(fileURLToPath(import.meta.url)), "../src/routes");

// Routers que legítimamente aplican auth "en blanco" (use() sin path).
// Deben montarse DESPUÉS de todos los routers públicos en index.ts.
// Si agregas un blanket guard a un router nuevo, agrégalo aquí SOLO tras
// verificar que se monta después de todas las rutas públicas.
const ALLOWED_BLANKET_GUARD_FILES = new Set([
  "cobros.ts",
  "clientes.ts",
  "liquidaciones.ts",
  "profile.ts",
  "subscription.ts",
  "workflows.ts",
]);

// Routers que exponen rutas públicas (sin sesión). Ningún router con blanket
// guard puede montarse antes que estos.
const PUBLIC_ROUTER_FILES = new Set([
  "health.ts",
  "auth.ts",
  "public-chat.ts",
  "webhooks.ts",
  "leads.ts",
  "portal.ts",
  "encuestas.ts",
]);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const indexSrc = stripComments(readFileSync(join(routesDir, "index.ts"), "utf8"));

// Mapa variable importada -> archivo (./cobros -> cobros.ts)
const importMap = new Map<string, string>();
for (const m of indexSrc.matchAll(
  /import\s+(?:\{\s*([\w$]+)\s*\}|([\w$]+))\s+from\s+["']\.\/([\w-]+)["']/g,
)) {
  importMap.set(m[1] ?? m[2], `${m[3]}.ts`);
}

// Orden de montaje: router.use(xRouter)
const mountOrder: string[] = [];
for (const m of indexSrc.matchAll(/^\s*router\.use\(([\w$]+)\)/gm)) {
  const file = importMap.get(m[1]);
  if (!file) {
    console.error(`ERROR: routes/index.ts monta "${m[1]}" pero no se pudo resolver su import.`);
    process.exit(1);
  }
  mountOrder.push(file);
}

if (mountOrder.length === 0) {
  console.error("ERROR: no se detectó ningún montaje en routes/index.ts (¿cambió el formato?).");
  process.exit(1);
}

const errors: string[] = [];

// Acepta prefijos literales o arrays literales no vacíos de prefijos seguros.
// Lo dinámico/desconocido se trata conservadoramente como no delimitado.
function hasBlanketUse(file: string): { line: number; text: string }[] {
  return findUnscopedUses(readFileSync(join(routesDir, file), "utf8"));
}

const publicMountPositions = mountOrder
  .map((f, i) => (PUBLIC_ROUTER_FILES.has(f) ? i : -1))
  .filter((i) => i >= 0);
const lastPublicIdx = Math.max(...publicMountPositions);

for (const [idx, file] of mountOrder.entries()) {
  const blanketUses = hasBlanketUse(file);
  const allowed = ALLOWED_BLANKET_GUARD_FILES.has(file);

  if (blanketUses.length > 0 && !allowed) {
    for (const hit of blanketUses) {
      errors.push(
        `routes/${file}:${hit.line} — \`.use()\` SIN prefijo seguro verificable en router montado en la cadena /api:\n` +
          `    ${hit.text}\n` +
          `  Puede interceptar las rutas montadas después (incluidas las públicas).\n` +
          `  Delimita el guard por prefijo (p. ej. router.use("/miprefijo", guard), ver gestiones.ts)\n` +
          `  o, si el blanket guard es intencional y el router se monta después de todas las rutas\n` +
          `  públicas, agrégalo a ALLOWED_BLANKET_GUARD_FILES en scripts/check-auth-guards.ts.`,
      );
    }
  }

  if (blanketUses.length > 0 && allowed && idx < lastPublicIdx) {
    const laterPublic = mountOrder.slice(idx + 1).filter((f) => PUBLIC_ROUTER_FILES.has(f));
    errors.push(
      `routes/index.ts — "${file}" (con blanket guard) está montado ANTES que routers públicos: ${laterPublic.join(", ")}.\n` +
        `  Su \`.use()\` sin path interceptará esas rutas públicas con 401. Muévelo después en el orden de montaje.`,
    );
  }

  if (allowed && blanketUses.length === 0) {
    errors.push(
      `Lista blanca obsoleta: routes/${file} está en ALLOWED_BLANKET_GUARD_FILES pero ya no tiene \`.use()\` sin path. Quítalo de la lista.`,
    );
  }
}

// Lista blanca no debe referenciar archivos no montados/inexistentes.
for (const file of ALLOWED_BLANKET_GUARD_FILES) {
  if (!mountOrder.includes(file)) {
    errors.push(
      `Lista blanca obsoleta: ${file} está en ALLOWED_BLANKET_GUARD_FILES pero no está montado en routes/index.ts.`,
    );
  }
}

if (errors.length > 0) {
  console.error("check-auth-guards: FALLÓ\n");
  for (const e of errors) console.error(`- ${e}\n`);
  process.exit(1);
}

console.log(
  `check-auth-guards: OK — ${mountOrder.length} routers montados, ` +
    `${[...ALLOWED_BLANKET_GUARD_FILES].length} con blanket guard permitido, ` +
    `todos montados después de las rutas públicas.`,
);
