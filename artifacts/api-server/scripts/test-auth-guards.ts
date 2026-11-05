import assert from "node:assert/strict";
import { test } from "node:test";
import { findUnscopedUses } from "./auth-guard-analysis";

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
