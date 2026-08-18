/**
 * Playwright globalTeardown: cleans up the DB by spawning db-teardown.ts via tsx.
 */
import { execSync } from "child_process";
import path from "path";

export default async function globalTeardown() {
  const root = process.cwd();
  execSync(`npx tsx ${path.join(root, "e2e", "db-teardown.ts")}`, {
    stdio: "inherit",
    cwd: root,
  });
}
