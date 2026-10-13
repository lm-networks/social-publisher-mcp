/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */
/**
 * Telegram notification after the queue publishes something.
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, optional TELEGRAM_THREAD_ID (forum topic).
 */

import type { RunReport } from "./queue.js";

const NAMES: Record<string, string> = { linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram" };
const ICON: Record<string, string> = { published: "✅", partial: "⚠️", failed: "❌", expired: "⌛" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function notifyTelegram(reports: RunReport[]): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chat) return;
  // Waiting-for-link entries are retried every few minutes; don't spam about them.
  const worth = reports.filter((r) => r.outcome in ICON);
  if (!worth.length) return;

  const blocks = worth.map((r) => {
    const lines = [`${ICON[r.outcome]} <b>${esc(r.label ?? r.id)}</b>`];
    for (const x of r.results ?? []) {
      const name = NAMES[x.platform] ?? x.platform;
      if (x.ok) lines.push(x.url ? `• ${name}: <a href="${esc(x.url)}">post</a>` : `• ${name}: opublikowano`);
      else lines.push(`• ${name}: błąd - ${esc(x.error.slice(0, 300))}`);
    }
    if (!r.results?.length && r.note) lines.push(esc(r.note));
    return lines.join("\n");
  });

  const body: Record<string, unknown> = {
    chat_id: chat,
    text: `📣 <b>Social publisher</b>\n\n${blocks.join("\n\n")}`,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  const thread = process.env.TELEGRAM_THREAD_ID?.trim();
  if (thread) body.message_thread_id = Number(thread);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
