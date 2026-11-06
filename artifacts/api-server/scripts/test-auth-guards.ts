import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnscopedUses } from "./auth-guard-analysis";
import { checkAuthGuards } from "./check-auth-guards";
import { analyzeRouterMounts } from "./router-mount-analysis";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const routesDir = join(dirname(fileURLToPath(import.meta.url)), "../src/routes");

function withFixture(
  transform: (source: string) => string,
  run: (fixture: string) => void,
) {
  const fixture = mkdtempSync(join(tmpdir(), "auth-guard-syntax-"));
  try {
    cpSync(routesDir, fixture, { recursive: true });
    const indexPath = join(fixture, "index.ts");
    writeFileSync(indexPath, transform(readFileSync(indexPath, "utf8")));
    run(fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("multiline mounts, aliases, comments and same-line calls retain every router in order", () => {
  const original = readFileSync(join(routesDir, "index.ts"), "utf8");
  const expected = analyzeRouterMounts(original, routesDir);
  assert.equal(expected.errors.length, 0);
  withFixture((src) => src
    .replace('import { profileRouter }', 'import {\n profileRouter as profileAlias,\n}')
    .replace('router.use(profileRouter);', 'router.use(profileAlias);')
    .replace('import healthRouter from', 'import renamedHealth from')
    .replace('router.use(healthRouter);', 'router.use(renamedHealth);')
    .replace(/router\.use\((\w+)\);/g, 'router /* comment */ . use(\n $1, // trailing comma\n);')
    + '\n// router.use(unknown);\nconst text = "router.use(unknown)";\n'
    + '/* router.use(unknown); */\nrouter.use(renamedHealth); router.use(renamedHealth);',
  (fixture) => {
    const result = analyzeRouterMounts(readFileSync(join(fixture, "index.ts"), "utf8"), fixture);
    assert.deepEqual(result, {
      errors: [],
      mountOrder: [...expected.mountOrder, "health.ts", "health.ts"],
    });
    // Extra public mounts at the end must still trigger ordering checks.
    assert.ok(checkAuthGuards(fixture).some((error) => /ANTES.*health\.ts/.test(error)));
  });
});

test("aliased named/default imports and literal path mounts resolve syntactically", () => {
  const result = analyzeRouterMounts(`
    import { default as health, authRouter as auth } from "./health.js";
    import { profileRouter as profile, type Ignored } from "./profile";
    router.use("/health", health, auth);
    router.use(["/profile", "/me"], profile);
  `, routesDir);
  assert.deepEqual(result, {
    mountOrder: ["health.ts", "health.ts", "profile.ts"], errors: [],
  });
});

for (const mount of [
  "router.use(unknown);",
  "router.use(makeRouter());",
  "router.use(...routers);",
  "router.use([healthRouter]);",
  "router.use(prefix, healthRouter);",
  "router.use(namespace.router);",
  "router.use();",
  'router.use("/prefix");',
  'router["use"](healthRouter);',
  "(router).use(healthRouter);",
  "(router.use)(healthRouter);",
  "(router.use as any)(healthRouter);",
  "(0, router.use)(healthRouter);",
  "const alias = router; alias.use(healthRouter);",
  "router.use(healthRouter).use(healthRouter);",
  "if (enabled) router.use(healthRouter);",
  "function mount() { router.use(healthRouter); }",
  "router?.use(healthRouter);",
  "router.use(healthRouter",
]) {
  test(`unresolvable mount fails even alongside valid mounts: ${mount}`, () => {
    withFixture((src) => `${src}\n${mount}`, (fixture) => {
      assert.ok(checkAuthGuards(fixture).some((error) => error.startsWith("ERROR:")));
    });
  });
}

for (const declaration of [
  'import missing from "./missing-file";',
  'import missing from "external-router";',
  'import type missing from "./health";',
  'import * as missing from "./health";',
]) {
  test(`unresolvable import fails: ${declaration}`, () => {
    withFixture((src) => `${declaration}\n${src}\nrouter.use(missing);`, (fixture) => {
      assert.ok(checkAuthGuards(fixture).some((error) => /ERROR:.*(resol|import)/.test(error)));
    });
  });
}

test("multiline unauthorized router cannot disappear from inspection", () => {
  withFixture((src) => `${src}
    import { default as hidden } from "./hidden";
    router.use(
      /* guard-bearing router */ hidden,
    );`, (fixture) => {
    writeFileSync(join(fixture, "hidden.ts"), "router.use(requireAuth);");
    const errors = checkAuthGuards(fixture);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /routes\/hidden.ts:1.*SIN prefijo/);
  });
});

test("parenthesized callee cannot hide a guard-bearing router alongside valid mounts", () => {
  withFixture((src) => `${src}
    import hiddenRouter from "./hidden";
    (router.use)(hiddenRouter);`, (fixture) => {
    writeFileSync(join(fixture, "hidden.ts"), "router.use(requireAuth);");
    assert.ok(checkAuthGuards(fixture).some((error) => /montaje no resoluble/.test(error)));
  });
});

test("multiline aliased public router still enforces order", () => {
  withFixture((src) => src
    .replace('import { organizationRouter }', 'import { organizationRouter as invitations }')
    .replace("router.use(organizationRouter);", "")
    .replace("router.use(cobrosRouter);", "router.use(cobrosRouter);\nrouter.use(\n invitations,\n);"),
  (fixture) => {
    const errors = checkAuthGuards(fixture);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /"cobros.ts".*ANTES.*organization\.ts/);
  });
});

test("multiline alias keeps stale whitelist detection for removed blanket guards", () => {
  withFixture((src) => src
    .replace("import cobrosRouter from", "import renamedCobros from")
    .replace("router.use(cobrosRouter);", "router.use(\n renamedCobros,\n);"),
  (fixture) => {
    writeFileSync(join(fixture, "cobros.ts"), 'router.use("/cobros", requireAuth);');
    const errors = checkAuthGuards(fixture);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Lista blanca obsoleta: routes\/cobros.ts.*ya no tiene/);
  });
});

test("whitelist still rejects a router no longer mounted", () => {
  withFixture((src) => src.replace("router.use(cobrosRouter);", ""), (fixture) => {
    const errors = checkAuthGuards(fixture);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Lista blanca obsoleta: cobros.ts.*no está montado/);
  });
});

test("comments and strings alone are not mounts", () => {
  const result = analyzeRouterMounts(`
    import healthRouter from "./health";
    // router.use(healthRouter);
    const text = "router.use(healthRouter)";
  `, routesDir);
  assert.deepEqual(result.mountOrder, []);
  assert.ok(result.errors.some((error) => /ningún montaje/.test(error)));
});

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
