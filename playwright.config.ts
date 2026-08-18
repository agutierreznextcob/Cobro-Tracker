import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for browser E2E tests against the Cobros App.
 *
 * Requires the API server to be running (artifacts/api-server: API Server
 * workflow). The cobros-app dev server is started automatically via webServer
 * if not already running.
 *
 * globalSetup seeds the DB (via tsx) and writes fixture data to
 * /tmp/e2e-inv-fixtures.json. globalTeardown cleans up.
 *
 * Run:
 *   npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // DB-seeded tests share fixture; keep serial
  retries: 0,
  reporter: [["list"]],

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: "http://localhost:23803",
    headless: true,
    screenshot: "only-on-failure",
    trace: "off",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // Starts the cobros-app dev server; PORT and BASE_PATH are required by
    // vite.config.ts. The /api proxy inside Vite forwards to localhost:8080.
    command:
      "PORT=23803 BASE_PATH=/ pnpm --filter @workspace/cobros-app run dev",
    port: 23803,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
