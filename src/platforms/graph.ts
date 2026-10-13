/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { requestJson } from "../http.js";

type Params = Record<string, string | number | boolean | undefined>;

/** Minimal Meta Graph API client; the token travels in the Authorization header, never in URLs. */
export class GraphClient {
  constructor(
    private readonly platform: string,
    private readonly host: string,
    private readonly version: string,
    private readonly token: string,
  ) {}

  url(path: string, host = this.host) {
    return `https://${host}/${this.version}/${path.replace(/^\//, "")}`;
  }

  private auth() {
    return { Authorization: `Bearer ${this.token}` };
  }

  async get<T = any>(path: string, params: Params = {}): Promise<T> {
    const qs = new URLSearchParams(clean(params)).toString();
    const { data } = await requestJson<T>(this.platform, this.url(path) + (qs ? `?${qs}` : ""), { headers: this.auth() });
    return data;
  }

  async post<T = any>(path: string, params: Params, host?: string): Promise<T> {
    const { data } = await requestJson<T>(this.platform, this.url(path, host), {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(clean(params)),
    });
    return data;
  }

  async postMultipart<T = any>(path: string, form: FormData, host?: string): Promise<T> {
    const { data } = await requestJson<T>(this.platform, this.url(path, host), {
      method: "POST",
      headers: this.auth(),
      body: form,
      timeoutMs: 600_000,
    });
    return data;
  }
}

function clean(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = String(v);
  return out;
}
