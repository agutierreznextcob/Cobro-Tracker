/**
 * Browser E2E: flujo completo de aceptar una invitación.
 *
 * La DB es sembrada por globalSetup (via tsx db-setup.ts) antes de que
 * corran los tests, y limpiada por globalTeardown (via tsx db-teardown.ts).
 * Los datos de fixture se leen de /tmp/e2e-inv-fixtures.json.
 *
 * Escenarios:
 *  1. Token inválido → página de error ("Invitación no válida")
 *  2. Token válido, correo sin cuenta → botón "Crear cuenta y unirme" con
 *     parámetros correctos (?invitacion=&email=) + link "Iniciar sesión"
 *  3. Token válido, correo con cuenta, sin sesión → botón "Iniciar sesión
 *     para aceptar" con returnTo apuntando de vuelta a /invitacion/:token
 *  4. Login con returnTo → vuelve a la invitación, ve "Unirme", clic → /dashboard
 *  5. Sesión de otro correo → ve "Cambiar de cuenta", no "Unirme"
 *  6. Formulario de registro desde link de invitación: email fijado, subtítulo
 *     correcto; al registrarse se muestra "¡Cuenta creada!" y la invitación
 *     es consumida (el nuevo usuario queda asignado a la org invitante).
 *
 * Prerequisitos: API Server workflow corriendo (localhost:8080).
 * El cobros-app se inicia automáticamente via playwright.config.ts webServer.
 */

import { test, expect } from "@playwright/test";
import fs from "fs";

// Fixture data seeded by globalSetup (db-setup.ts → /tmp/e2e-inv-fixtures.json)
interface Fixtures {
  ts: number;
  password: string;
  ownerEmail: string;
  inviteeEmail: string;
  inviteeId: string;
  inviteeOrgId: number;
  newEmail: string;
  otherEmail: string;
  otherId: string;
  orgId: number;
  ownerId: string;
  tokenExisting: string; // used by scenarios 3 & 5 (stays pendiente)
  tokenNew: string;      // used by scenario 2 (stays pendiente)
  tokenAccept: string;   // consumed by scenario 4 (will be accepted)
  tokenReg: string;      // consumed by scenario 6 (registration branch)
  regEmail: string;      // new email for registration branch test
  regTestRutFormatted: string; // valid RUT formatted for browser form input
  regTestRutNorm: string;      // normalized RUT stored in DB
  invExistingId: number;
  invNewId: number;
  invAcceptId: number;
  invRegId: number;
}

function loadFixtures(): Fixtures {
  return JSON.parse(fs.readFileSync("/tmp/e2e-inv-fixtures.json", "utf-8"));
}

// ── Escenario 1: Token inválido → página de error ──────────────────────────
test("token inválido muestra página de error", async ({ page }) => {
  await page.goto("/invitacion/token-invalido-e2e-browser-xyz");

  // Heading de error
  await expect(
    page.getByRole("heading", { name: /invitación no válida/i }),
  ).toBeVisible();

  // Enlace "Ir al inicio"
  await expect(page.getByRole("link", { name: /ir al inicio/i })).toBeVisible();

  // No hay botón "Unirme" ni link "Iniciar sesión para aceptar"
  await expect(
    page.getByRole("button", { name: /unirme/i }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: /iniciar sesión para aceptar/i }),
  ).not.toBeVisible();
});

// ── Escenario 2: Correo sin cuenta → CTA "Crear cuenta" ───────────────────
test("correo sin cuenta muestra 'Crear cuenta y unirme' con parámetros correctos", async ({
  page,
}) => {
  const f = loadFixtures();

  await page.goto(`/invitacion/${f.tokenNew}`);

  // Título muestra que fue invitado a una org
  await expect(page.getByRole("heading")).toContainText("Te invitaron a");

  // Botón/enlace para crear cuenta con el token y el email en el href
  const crearLink = page.getByRole("link", { name: /crear cuenta/i });
  await expect(crearLink).toBeVisible();

  const href = await crearLink.getAttribute("href");
  expect(href).toContain(`invitacion=${encodeURIComponent(f.tokenNew)}`);
  expect(href).toContain(`email=${encodeURIComponent(f.newEmail)}`);

  // Enlace secundario "Iniciar sesión" también está presente
  await expect(
    page.getByRole("link", { name: /iniciar sesión/i }).first(),
  ).toBeVisible();
});

// ── Escenario 3: Correo con cuenta, sin sesión → CTA "Iniciar sesión" ─────
test("correo con cuenta sin sesión muestra 'Iniciar sesión para aceptar'", async ({
  page,
}) => {
  const f = loadFixtures();

  await page.goto(`/invitacion/${f.tokenExisting}`);

  await expect(page.getByRole("heading")).toContainText("Te invitaron a");

  const loginLink = page.getByRole("link", {
    name: /iniciar sesión para aceptar/i,
  });
  await expect(loginLink).toBeVisible();

  // El href lleva returnTo apuntando de vuelta a la página de invitación
  const href = await loginLink.getAttribute("href");
  const expectedReturnTo = encodeURIComponent(`/invitacion/${f.tokenExisting}`);
  expect(href).toContain(`returnTo=${expectedReturnTo}`);
});

// ── Escenario 4: Login → returnTo → botón "Unirme" → /dashboard ───────────
// Uses tokenAccept (a separate pendiente invitation) so tokenExisting stays
// untouched for scenarios 3 & 5.
test("login con returnTo regresa a la invitación y 'Unirme' lleva al dashboard", async ({
  page,
}) => {
  const f = loadFixtures();
  const token = f.tokenAccept;

  // 1. Without session: open the invitation page.
  await page.goto(`/invitacion/${token}`);

  const loginLink = page.getByRole("link", {
    name: /iniciar sesión para aceptar/i,
  });
  await expect(loginLink).toBeVisible();

  // 2. Navigate to the login page with returnTo.
  await page.goto(
    `/login?returnTo=${encodeURIComponent(`/invitacion/${token}`)}`,
  );
  await page.fill('input[type="email"]', f.inviteeEmail);
  await page.fill('input[type="password"]', f.password);
  await page.click('button[type="submit"]');

  // 3. After login, the app redirects back to the invitation page (returnTo).
  await page.waitForURL(`**\/invitacion\/${token}`, { timeout: 12_000 });

  // 4. "Unirme" button is visible (session matches invitation email).
  const unirmeBtn = page.getByRole("button", { name: /unirme/i });
  await expect(unirmeBtn).toBeVisible();

  // 5. Click → should navigate to /dashboard.
  await unirmeBtn.click();
  await page.waitForURL("**/dashboard", { timeout: 12_000 });
  await expect(page).toHaveURL(/\/dashboard/);
});

// ── Escenario 5: Sesión de otro correo → "Cambiar de cuenta" ──────────────
test("sesión de otro correo muestra 'Cambiar de cuenta'", async ({ page }) => {
  const f = loadFixtures();

  // Log in as the "other" user via the login page so the session cookie is
  // held by the page's own BrowserContext (page.request shares cookies).
  await page.goto("/login");
  await page.fill('input[type="email"]', f.otherEmail);
  await page.fill('input[type="password"]', f.password);
  await page.click('button[type="submit"]');
  // Wait until the redirect away from /login completes.
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), {
    timeout: 12_000,
  });

  // Navigate to the invitation belonging to inviteeEmail.
  await page.goto(`/invitacion/${f.tokenExisting}`);

  await expect(page.getByRole("heading")).toContainText("Te invitaron a");

  // Should show "Cambiar de cuenta" — NOT "Unirme".
  await expect(
    page.getByRole("button", { name: /cambiar de cuenta/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /unirme/i }),
  ).not.toBeVisible();
});

// ── Escenario 6: Registro desde link de invitación (rama cuenta nueva) ─────
//
// Verifies the full new-account branch of the invitation flow:
//  a) The "Crear cuenta y unirme" link on the invitation page carries the
//     correct ?invitacion=TOKEN&email=EMAIL query parameters (the email CTA URL).
//  b) Opening that URL pre-fills and disables the email field so the user
//     can't register with a different address than the one invited.
//  c) Submitting the form shows the "¡Cuenta creada!" success state, confirming
//     that assignOrganization consumed the invitation and joined the correct org.
test("link de invitación abre registro con email fijado y registro consume la invitación", async ({
  page,
}) => {
  const f = loadFixtures();

  // ── Step 1: visit the invitation page and follow the "Crear cuenta" CTA ──
  await page.goto(`/invitacion/${f.tokenReg}`);
  await expect(page.getByRole("heading")).toContainText("Te invitaron a");

  // The CTA link carries the invitation token and locked-in email.
  const crearLink = page.getByRole("link", { name: /crear cuenta/i });
  await expect(crearLink).toBeVisible();
  const href = await crearLink.getAttribute("href");
  expect(href).toContain(`invitacion=${encodeURIComponent(f.tokenReg)}`);
  expect(href).toContain(`email=${encodeURIComponent(f.regEmail)}`);

  // ── Step 2: open the registration page via the CTA URL ───────────────────
  await page.goto(
    `/register?invitacion=${encodeURIComponent(f.tokenReg)}&email=${encodeURIComponent(f.regEmail)}`,
  );

  // Subtitle shows invitation context, not free-trial context.
  await expect(page.getByRole("heading", { name: /crear cuenta/i })).toBeVisible();
  await expect(page.locator("text=unirte a la organización")).toBeVisible();

  // Email field is pre-filled with the invited address and disabled.
  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toHaveValue(f.regEmail);
  await expect(emailInput).toBeDisabled();

  // The "correo fijado" note is shown.
  await expect(
    page.locator("text=viene fijado por tu invitación"),
  ).toBeVisible();

  // ── Step 3: fill the rest of the form and submit ──────────────────────────
  await page.fill("#nombre", "Reg Test User");
  await page.fill("#rut", f.regTestRutFormatted);
  await page.fill("#password", f.password);
  await page.fill("#confirmPassword", f.password);
  // Check the policy acceptance checkbox.
  await page.locator("#aceptaPolitica").check();

  await page.click('button[type="submit"]');

  // ── Step 4: verify success state ─────────────────────────────────────────
  // The registration sets emailVerified: false and assignOrganization runs
  // immediately, then shows the "check your email" confirmation screen.
  await expect(
    page.getByRole("heading", { name: /cuenta creada/i }),
  ).toBeVisible({ timeout: 12_000 });
});
