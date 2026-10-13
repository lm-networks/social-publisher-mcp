/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env");

if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

export function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Brak zmiennej ${name} (ustaw ją w .env lub w środowisku).`);
    process.exit(1);
  }
  return v;
}

/** Inserts or replaces KEY=value lines in .env. */
export function upsertEnv(values: Record<string, string>) {
  let lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  lines = lines.filter((l, i) => l !== "" || i < lines.length - 1);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n");
  console.log(`Zapisano ${Object.keys(values).join(", ")} do ${ENV_PATH}`);
}

export const hasFlag = (flag: string) => process.argv.includes(flag);

export function flagValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
