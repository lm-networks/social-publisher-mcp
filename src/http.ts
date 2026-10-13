/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

export class ApiError extends Error {
  constructor(
    readonly platform: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(`[${platform}] HTTP ${status}: ${message}`);
  }
}

export interface JsonResponse<T = any> {
  data: T;
  headers: Headers;
  status: number;
}

function errorMessage(data: any, fallback: string): string {
  if (data && typeof data === "object") {
    const e = data.error ?? data;
    const parts = [e.message, e.error_user_title, e.error_user_msg].filter(Boolean);
    if (e.code !== undefined) parts.push(`(code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})`);
    if (data.serviceErrorCode) parts.push(`(serviceErrorCode ${data.serviceErrorCode})`);
    if (parts.length) return parts.join(" ");
  }
  if (typeof data === "string" && data) return data.slice(0, 500);
  return fallback;
}

export async function requestJson<T = any>(
  platform: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<JsonResponse<T>> {
  const { timeoutMs = 120_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(platform, res.status, errorMessage(data, res.statusText), data);
  return { data, headers: res.headers, status: res.status };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
