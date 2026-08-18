/**
 * Playwright globalSetup: seeds the DB by spawning db-setup.ts via tsx.
 * tsx correctly resolves @workspace/* packages via pnpm's virtual store.
 */
import { execSync } from "child_process";
import path from "path";

export default async function globalSetup() {
  const root = process.cwd(); // workspace root (where playwright.config.ts lives)
  execSync(`npx tsx ${path.join(root, "e2e", "db-setup.ts")}`, {
    stdio: "inherit",
    cwd: root,
  });
}
