/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

export interface MediaFile {
  data: Uint8Array<ArrayBuffer>;
  contentType: string;
  filename: string;
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v"]);

export const isUrl = (src: string) => /^https?:\/\//i.test(src);

export function isVideo(src: string): boolean {
  const path = isUrl(src) ? new URL(src).pathname : src;
  return VIDEO_EXT.has(extname(path).toLowerCase());
}

/** Reads media from an http(s) URL, a file:// URL or a local path. */
export async function loadMedia(src: string): Promise<MediaFile> {
  if (isUrl(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Nie udało się pobrać ${src}: HTTP ${res.status}`);
    const name = basename(new URL(src).pathname) || "media";
    const contentType =
      res.headers.get("content-type")?.split(";")[0] ?? MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
    return { data: new Uint8Array(await res.arrayBuffer()), contentType, filename: name };
  }
  const path = src.startsWith("file://") ? fileURLToPath(src) : resolve(src);
  const data = await readFile(path);
  return {
    data: new Uint8Array(data),
    contentType: MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
    filename: basename(path),
  };
}

/**
 * Instagram only accepts public https URLs. When SOCIAL_MCP_PUBLIC_URL is set, a local path is
 * served from <mediaDir> via /media/ (files outside it are copied in first).
 */
export async function publicMediaUrl(src: string): Promise<string> {
  if (isUrl(src) || !config.publicUrl) return src;
  const path = src.startsWith("file://") ? fileURLToPath(src) : resolve(src);
  let rel = relative(config.mediaDir, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    const data = await readFile(path);
    rel = join("uploads", `${createHash("sha1").update(data).digest("hex").slice(0, 10)}-${basename(path)}`);
    await mkdir(join(config.mediaDir, "uploads"), { recursive: true });
    await writeFile(join(config.mediaDir, rel), data);
  }
  return `${config.publicUrl}/media/${rel.split(sep).map(encodeURIComponent).join("/")}`;
}

/** Saves uploaded bytes into <mediaDir>/uploads and returns the local path and public URL. */
export async function saveUpload(filename: string, data: Uint8Array): Promise<{ path: string; url?: string }> {
  const name = `${createHash("sha1").update(data).digest("hex").slice(0, 10)}-${basename(filename).replace(/[^\w.-]+/g, "_")}`;
  const path = join(config.mediaDir, "uploads", name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return { path, url: config.publicUrl ? `${config.publicUrl}/media/uploads/${encodeURIComponent(name)}` : undefined };
}
