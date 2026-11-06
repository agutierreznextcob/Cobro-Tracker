import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnscopedUses } from "./auth-guard-analysis";
import { checkAuthGuards } from "./check-auth-guards";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const routesDir = join(dirname(fileURLToPath(import.meta.url)), "../src/routes");

test("current router order preserves every public route", () => {
  assert.deepEqual(checkAuthGuards(routesDir), []);
});

for (const router of ["organization", "consultor"]) {
  test(`rejects ${router} mounted after a permitted blanket guard`, () => {
    const fixture = mkdtempSync(join(tmpdir(), "auth-guard-order-"));
    try {
      cpSync(routesDir, fixture, { recursive: true });
      const indexPath = join(fixture, "index.ts");
      const mount = `router.use(${router}Router);`;
      const source = readFileSync(indexPath, "utf8");
      assert.equal(source.split(mount).length, 2);
      // Leave all other public routers before cobros: only this router makes
      // the order unsafe, so an omitted PUBLIC_ROUTER_FILES entry fails here.
      writeFileSync(indexPath, source.replace(mount, "").replace(
        "router.use(cobrosRouter);",
        `router.use(cobrosRouter);\n${mount}`,
      ));
      const errors = checkAuthGuards(fixture);
      assert.equal(errors.length, 1);
      assert.match(errors[0], new RegExp(`"cobros.ts".*ANTES.*${router}\\.ts`));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}

const safe = [
  'router.use("/locales", guard);',
  "aiRouter.use('/ai', guard);",
  'router.use(`/locales`, guard);',
  'router.use(["/locales", "/bodegas"], guard);',
  'router.use(["/locales"], guard);',
  `router.use(
    ["/locales", /* comment , ] */ "/bodegas",],
    guard,
  );`,
  'router.use("/cobros/:id/gestiones", guard);',
  '// router.use(guard);\n/* router.use(guard); */',
  'const text = "router.use(guard)";',
];
for (const src of safe) {
  test(`safe: ${src}`, () => assert.deepEqual(findUnscopedUses(src), []));
}

const unsafe = [
  "router.use(guard);",
  "clientesRouter.use(requireSubscription);",
  "router.use(() => {});",
  "router.use(\n  guard\n);",
  "router.use([] , guard);",
  "router.use(paths, guard);",
  'router.use(["/locales", path], guard);',
  'router.use(["/locales", ...paths], guard);',
  'router.use([guard], otherGuard);',
  'router.use(["/locales", ""], guard);',
  'router.use(["/locales", "/"], guard);',
  'router.use(["/locales", /./], guard);',
  'router.use(["/locales", `/bodegas/${id}`], guard);',
  'router.use("/" , guard);',
  'router.use("", guard);',
  'router.use("/{*path}", guard);',
  'router.use(`/${prefix}`, guard);',
  'router.use("/locales" + suffix, guard);',
  'router.use(["/locales", , "/bodegas"], guard);',
];
for (const src of unsafe) {
  test(`unsafe: ${src}`, () => assert.equal(findUnscopedUses(src).length, 1));
}

test("reports real line numbers and every unscoped use", () => {
  const hits = findUnscopedUses(`/* comment
  spanning lines */
router.use(["/locales", "/bodegas"], guard); router.use(guard);
aiRouter.use(
  requireSubscription
);`);
  assert.deepEqual(hits.map((hit) => hit.line), [3, 4]);
});
