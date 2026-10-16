/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, openSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crossPost, type CrossPost, type CrossPostResult } from "./publish.js";
import type { Platform } from "./types.js";

/**
 * Publication queue: LinkedIn and Instagram have no scheduling in their APIs, so scheduled
 * posts are stored in a JSON file and sent by `publish-due` (run every few minutes by
 * Windows Task Scheduler / cron) or by the run_due_posts tool.
 */

export const QUEUE_FILE = resolve(
  process.env.SOCIAL_MCP_QUEUE_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "..", "schedule.json"),
);
const LOCK_FILE = `${QUEUE_FILE}.lock`;
const MAX_ATTEMPTS = 3;
/** Posts more than this late (e.g. the computer was off) are marked expired instead of sent. */
const MAX_DELAY_MS = Number(process.env.SOCIAL_MCP_MAX_DELAY_HOURS ?? 12) * 3600_000;

export type EntryStatus = "pending" | "done" | "failed" | "expired" | "cancelled";

export interface QueueEntry {
  id: string;
  label?: string;
  publishAt: string;
  createdAt: string;
  status: EntryStatus;
  post: CrossPost;
  /** Don't publish until linkUrl returns HTTP 200 (e.g. a blog post that goes live the same day). */
  waitForLink?: boolean;
  /** Platforms already published successfully. */
  done: Platform[];
  attempts: number;
  results: (CrossPostResult & { at: string })[];
  lastError?: string;
}

function load(): QueueEntry[] {
  return existsSync(QUEUE_FILE) ? JSON.parse(readFileSync(QUEUE_FILE, "utf8")) : [];
}

function save(entries: QueueEntry[]) {
  const tmp = `${QUEUE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2) + "\n");
  renameSync(tmp, QUEUE_FILE);
}

/** Cross-process lock so the MCP server and the scheduled runner never publish twice. */
async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      closeSync(openSync(LOCK_FILE, "wx"));
      break;
    } catch {
      if (existsSync(LOCK_FILE) && Date.now() - statSync(LOCK_FILE).mtimeMs > 15 * 60_000) unlinkSync(LOCK_FILE);
      if (i > 100) throw new Error(`Kolejka zablokowana (${LOCK_FILE}).`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    return await fn();
  } finally {
    unlinkSync(LOCK_FILE);
  }
}

export interface NewEntry {
  publishAt: string;
  post: CrossPost;
  label?: string;
  waitForLink?: boolean;
}

export function addEntries(items: NewEntry[]): Promise<QueueEntry[]> {
  const created = items.map((item): QueueEntry => {
    const ts = Date.parse(item.publishAt);
    if (Number.isNaN(ts)) throw new Error(`Niepoprawna data publish_at: ${item.publishAt} (użyj ISO 8601).`);
    if (!item.post.platforms.length) throw new Error("Podaj co najmniej jedną platformę.");
    if (item.post.platforms.includes("instagram") && !(item.post.instagramImages ?? item.post.images)?.length)
      throw new Error(`Instagram wymaga zdjęcia (wpis: ${item.label ?? item.post.text.slice(0, 40)}).`);
    return {
      id: randomUUID().slice(0, 8),
      label: item.label,
      publishAt: new Date(ts).toISOString(),
      createdAt: new Date().toISOString(),
      status: "pending",
      post: item.post,
      waitForLink: item.waitForLink,
      done: [],
      attempts: 0,
      results: [],
    };
  });
  return withLock(() => {
    save([...load(), ...created]);
    return created;
  });
}

export function listEntries(status?: EntryStatus): QueueEntry[] {
  return load()
    .filter((e) => !status || e.status === status)
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
}

export function cancelEntry(id: string): Promise<QueueEntry> {
  return withLock(() => {
    const entries = load();
    const e = entries.find((x) => x.id === id);
    if (!e) throw new Error(`Nie ma wpisu ${id} w kolejce.`);
    if (e.status !== "pending") throw new Error(`Wpis ${id} ma status ${e.status} — można anulować tylko oczekujące.`);
    e.status = "cancelled";
    save(entries);
    return e;
  });
}

export interface EntryPatch {
  publishAt?: string;
  label?: string;
  waitForLink?: boolean;
  post?: Partial<CrossPost>;
}

/** Edits a pending entry (admin panel). Published or cancelled entries stay as they were. */
export function updateEntry(id: string, patch: EntryPatch): Promise<QueueEntry> {
  return withLock(() => {
    const entries = load();
    const e = entries.find((x) => x.id === id);
    if (!e) throw new Error(`Nie ma wpisu ${id} w kolejce.`);
    if (e.status !== "pending") throw new Error(`Wpis ${id} ma status ${e.status} - można edytować tylko oczekujące.`);
    if (patch.publishAt !== undefined) {
      const ts = Date.parse(patch.publishAt);
      if (Number.isNaN(ts)) throw new Error(`Niepoprawna data publish_at: ${patch.publishAt} (użyj ISO 8601).`);
      e.publishAt = new Date(ts).toISOString();
    }
    if (patch.label !== undefined) e.label = patch.label;
    if (patch.waitForLink !== undefined) e.waitForLink = patch.waitForLink;
    if (patch.post) {
      const post = { ...e.post, ...patch.post };
      if (!post.platforms?.length) throw new Error("Podaj co najmniej jedną platformę.");
      if (post.platforms.includes("instagram") && !(post.instagramImages ?? post.images)?.length)
        throw new Error("Instagram wymaga zdjęcia.");
      e.post = post;
    }
    e.lastError = undefined;
    save(entries);
    return e;
  });
}

async function linkIsLive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(20_000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface RunReport {
  id: string;
  label?: string;
  outcome: "published" | "partial" | "failed" | "expired" | "waiting-for-link" | "dry-run";
  results?: CrossPostResult[];
  note?: string;
}

/** Publishes every pending entry whose time has come. */
export function runDue(opts: { dryRun?: boolean; now?: Date } = {}): Promise<RunReport[]> {
  const now = (opts.now ?? new Date()).getTime();
  return withLock(async () => {
    const entries = load();
    const reports: RunReport[] = [];
    for (const e of entries) {
      if (e.status !== "pending" || Date.parse(e.publishAt) > now) continue;

      if (now - Date.parse(e.publishAt) > MAX_DELAY_MS) {
        if (!opts.dryRun) e.status = "expired";
        reports.push({ id: e.id, label: e.label, outcome: "expired", note: `Spóźnienie > ${MAX_DELAY_MS / 3600_000} h.` });
        continue;
      }
      if (e.waitForLink && e.post.linkUrl && !(await linkIsLive(e.post.linkUrl))) {
        if (!opts.dryRun) e.lastError = `Link jeszcze niedostępny: ${e.post.linkUrl}`;
        reports.push({ id: e.id, label: e.label, outcome: "waiting-for-link", note: e.post.linkUrl });
        continue;
      }

      const remaining = e.post.platforms.filter((p) => !e.done.includes(p));
      const results = await crossPost({ ...e.post, platforms: remaining }, !!opts.dryRun);
      if (opts.dryRun) {
        reports.push({ id: e.id, label: e.label, outcome: "dry-run", results });
        continue;
      }

      const at = new Date().toISOString();
      e.attempts++;
      e.results.push(...results.map((r) => ({ ...r, at })));
      for (const r of results) if (r.ok) e.done.push(r.platform);
      const failed = results.filter((r) => !r.ok);
      e.lastError = failed.map((r) => (r.ok ? "" : r.error)).join(" | ") || undefined;
      if (!failed.length) e.status = "done";
      else if (e.attempts >= MAX_ATTEMPTS) e.status = "failed";
      reports.push({
        id: e.id,
        label: e.label,
        outcome: !failed.length ? "published" : failed.length < results.length ? "partial" : "failed",
        results,
        note: failed.length && e.status === "pending" ? `Ponowna próba przy następnym uruchomieniu (${e.attempts}/${MAX_ATTEMPTS}).` : undefined,
      });
      save(entries); // persist after every entry, so a crash never causes a double post
    }
    if (!opts.dryRun) save(entries);
    return reports;
  });
}
