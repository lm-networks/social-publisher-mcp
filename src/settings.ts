/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMi GRAF Tech Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMi GRAF Tech Lab
 */
/**
 * Connection settings edited from the admin panel. Values go to settings.json (overrides .env)
 * and take effect after the process restarts (Docker brings the container back up).
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { config, SETTINGS_FILE } from "./config.js";

export type SettingsGroup = "facebook" | "instagram" | "linkedin" | "telegram" | "general";

export const FIELDS: { key: string; group: SettingsGroup; secret: boolean }[] = [
  { key: "FACEBOOK_PAGE_ID", group: "facebook", secret: false },
  { key: "FACEBOOK_PAGE_ACCESS_TOKEN", group: "facebook", secret: true },
  { key: "META_APP_ID", group: "facebook", secret: false },
  { key: "META_APP_SECRET", group: "facebook", secret: true },
  { key: "META_GRAPH_API_VERSION", group: "facebook", secret: false },
  { key: "INSTAGRAM_USER_ID", group: "instagram", secret: false },
  { key: "INSTAGRAM_ACCESS_TOKEN", group: "instagram", secret: true },
  { key: "INSTAGRAM_API_HOST", group: "instagram", secret: false },
  { key: "LINKEDIN_ACCESS_TOKEN", group: "linkedin", secret: true },
  { key: "LINKEDIN_TOKEN_EXPIRES", group: "linkedin", secret: false },
  { key: "LINKEDIN_AUTHOR_URN", group: "linkedin", secret: false },
  { key: "LINKEDIN_COMMENTS", group: "linkedin", secret: false },
  { key: "LINKEDIN_CLIENT_ID", group: "linkedin", secret: false },
  { key: "LINKEDIN_CLIENT_SECRET", group: "linkedin", secret: true },
  { key: "LINKEDIN_API_VERSION", group: "linkedin", secret: false },
  { key: "TELEGRAM_BOT_TOKEN", group: "telegram", secret: true },
  { key: "TELEGRAM_CHAT_ID", group: "telegram", secret: false },
  { key: "TELEGRAM_THREAD_ID", group: "telegram", secret: false },
  { key: "SOCIAL_MCP_QUEUE_INTERVAL_MIN", group: "general", secret: false },
  { key: "SOCIAL_MCP_DRY_RUN", group: "general", secret: false },
];

export const STARTED_AT = new Date().toISOString();

function readOverlay(): Record<string, string> {
  try {
    return existsSync(SETTINGS_FILE) ? JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) : {};
  } catch {
    return {};
  }
}

/** Current values as the running process sees them; secrets only as their last 4 characters. */
export function describeSettings() {
  const overlay = readOverlay();
  return {
    startedAt: STARTED_AT,
    fields: FIELDS.map((f) => {
      const v = process.env[f.key]?.trim() ?? "";
      return {
        key: f.key,
        group: f.group,
        secret: f.secret,
        set: v !== "",
        value: f.secret ? (v ? `…${v.slice(-4)}` : "") : v,
        source: overlay[f.key] ? "panel" : v ? "env" : "",
      };
    }),
    platforms: {
      facebook: !!config.facebook,
      instagram: !!config.instagram,
      linkedin: !!config.linkedin,
      telegram: !!(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim()),
    },
  };
}

/** string = new value, "" = keep, null = remove from settings.json (falls back to .env). */
export function saveSettings(patch: Record<string, unknown>): string[] {
  const allowed = new Set(FIELDS.map((f) => f.key));
  const overlay = readOverlay();
  const changed: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k)) throw new Error(`Nieznane ustawienie: ${k}`);
    if (v === null) {
      if (k in overlay) changed.push(k);
      delete overlay[k];
      continue;
    }
    if (typeof v !== "string") throw new Error(`${k}: oczekiwany tekst.`);
    const t = v.trim();
    const current = process.env[k]?.trim() ?? "";
    const isBool = /^(true|false|1|0|yes|no)?$/i.test(t) && /_(COMMENTS|DRY_RUN)$/.test(k);
    const same = isBool ? ["1", "true", "yes"].includes(t.toLowerCase()) === ["1", "true", "yes"].includes(current.toLowerCase()) : t === current;
    // "" = keep; a value equal to what is already in effect is not a change (no copy of .env into the panel)
    if (t === "" || overlay[k] === t || (!(k in overlay) && same)) continue;
    overlay[k] = t;
    changed.push(k);
  }
  if (changed.length) {
    const tmp = `${SETTINGS_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(overlay, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, SETTINGS_FILE);
  }
  return changed;
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? body?.description ?? `HTTP ${res.status}`);
  return body;
}

/** Checks the running credentials against each platform without publishing anything. */
export async function testPlatform(platform: string): Promise<{ ok: boolean; info?: string; error?: string }> {
  try {
    if (platform === "facebook") {
      const c = config.facebook;
      if (!c) throw new Error("brak FACEBOOK_PAGE_ID lub tokenu strony");
      const j = await getJson(
        `https://graph.facebook.com/${config.graphVersion}/${c.pageId}?fields=name&access_token=${encodeURIComponent(c.pageAccessToken)}`,
      );
      return { ok: true, info: `strona „${j.name}”` };
    }
    if (platform === "instagram") {
      const c = config.instagram;
      if (!c) throw new Error("brak INSTAGRAM_USER_ID");
      const j = await getJson(
        `https://${c.host}/${config.graphVersion}/${c.userId}?fields=username&access_token=${encodeURIComponent(c.accessToken)}`,
      );
      return { ok: true, info: `konto @${j.username}` };
    }
    if (platform === "linkedin") {
      const c = config.linkedin;
      if (!c) throw new Error("brak LINKEDIN_ACCESS_TOKEN");
      const j = await getJson("https://api.linkedin.com/v2/userinfo", { Authorization: `Bearer ${c.accessToken}` });
      return { ok: true, info: `zalogowany jako ${j.name ?? j.sub}${c.authorUrn ? `, publikuje jako ${c.authorUrn}` : ""}` };
    }
    if (platform === "telegram") {
      const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
      if (!token) throw new Error("brak TELEGRAM_BOT_TOKEN");
      const j = await getJson(`https://api.telegram.org/bot${token}/getMe`);
      return { ok: true, info: `bot @${j.result?.username}` };
    }
    throw new Error(`nieznana platforma ${platform}`);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
