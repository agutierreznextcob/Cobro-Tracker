import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export async function readLogoCursor(file: string): Promise<string | null> {
  let raw: string;
  try { raw = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const state = JSON.parse(raw);
  if (state.afterPath !== null && (typeof state.afterPath !== "string" || state.afterPath.length > 1024)) {
    throw new Error("Invalid cleanup cursor; reset the cursor file before retrying.");
  }
  return state.afterPath;
}

export async function writeLogoCursor(file: string, report: { path: string }[]) {
  const afterPath = report.at(-1)?.path ?? null;
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ afterPath }), { mode: 0o600 });
  await rename(temporary, file);
  return afterPath;
}
