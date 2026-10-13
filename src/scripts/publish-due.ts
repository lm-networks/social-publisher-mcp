/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */
/**
 * Sends every due post from the queue. Meant to run every few minutes, e.g.
 *   schtasks /Create /SC MINUTE /MO 10 /TN social-publisher /TR "node <path>\dist\scripts\publish-due.js"
 * Flags: --dry-run (show only)
 */
import { appendFileSync } from "node:fs";
import { runDue, QUEUE_FILE } from "../queue.js";

const dryRun = process.argv.includes("--dry-run");
const reports = await runDue({ dryRun });
const stamp = new Date().toISOString();
const lines = reports.map((r) => {
  const urls = r.results?.map((x) => (x.ok ? `${x.platform}: ${x.url ?? x.id ?? "ok"}` : `${x.platform}: BŁĄD ${x.error}`)).join("; ");
  return `${stamp} [${r.outcome}] ${r.id} ${r.label ?? ""} ${urls ?? r.note ?? ""}`.trim();
});
if (lines.length) {
  console.log(lines.join("\n"));
  if (!dryRun) appendFileSync(`${QUEUE_FILE}.log`, lines.join("\n") + "\n");
} else console.log(`${stamp} brak postów do wysłania`);
process.exitCode = reports.some((r) => r.outcome === "failed") ? 1 : 0;
