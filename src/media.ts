/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
