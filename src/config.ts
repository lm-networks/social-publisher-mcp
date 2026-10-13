/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load <project>/.env if present (Node >= 20.12). Real env vars take precedence.
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(PROJECT_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = (name: string): string | undefined => {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
};

export interface LinkedInConfig {
  accessToken: string;
  authorUrn?: string;
  /** YYYYMM; when unset the client picks the newest active version itself. */
  apiVersion?: string;
  /** Comments need the Community Management API; without it the link goes into the post text. */
  commentsEnabled: boolean;
}

export interface FacebookConfig {
  pageId: string;
  pageAccessToken: string;
}

export interface InstagramConfig {
  userId: string;
  accessToken: string;
  /** graph.facebook.com (Facebook Login) or graph.instagram.com (Instagram Login). */
  host: string;
}

export interface HttpConfig {
  host: string;
  port: number;
  authToken?: string;
}

export interface Config {
  graphVersion: string;
  /** Public base URL of this server (e.g. https://mcp.example.com); enables /media hosting for Instagram. */
  publicUrl?: string;
  mediaDir: string;
  http: HttpConfig;
  dryRunByDefault: boolean;
  linkedin?: LinkedInConfig;
  facebook?: FacebookConfig;
  instagram?: InstagramConfig;
}

function load(): Config {
  const liToken = env("LINKEDIN_ACCESS_TOKEN");
  const fbPage = env("FACEBOOK_PAGE_ID");
  const fbToken = env("FACEBOOK_PAGE_ACCESS_TOKEN");
  const igUser = env("INSTAGRAM_USER_ID");
  const igToken = env("INSTAGRAM_ACCESS_TOKEN") ?? fbToken;

  return {
    graphVersion: env("META_GRAPH_API_VERSION") ?? "v24.0",
    publicUrl: env("SOCIAL_MCP_PUBLIC_URL")?.replace(/\/+$/, ""),
    mediaDir: resolve(PROJECT_ROOT, env("SOCIAL_MCP_MEDIA_DIR") ?? "media"),
    http: {
      host: env("MCP_HTTP_HOST") ?? "127.0.0.1",
      port: Number(env("MCP_HTTP_PORT") ?? 3100),
      authToken: env("MCP_AUTH_TOKEN"),
    },
    dryRunByDefault: ["1", "true", "yes"].includes((env("SOCIAL_MCP_DRY_RUN") ?? "").toLowerCase()),
    linkedin: liToken
      ? {
          accessToken: liToken,
          authorUrn: env("LINKEDIN_AUTHOR_URN"),
          apiVersion: env("LINKEDIN_API_VERSION"),
          commentsEnabled: ["1", "true", "yes"].includes((env("LINKEDIN_COMMENTS") ?? "").toLowerCase()),
        }
      : undefined,
    facebook: fbPage && fbToken ? { pageId: fbPage, pageAccessToken: fbToken } : undefined,
    instagram:
      igUser && igToken
        ? { userId: igUser, accessToken: igToken, host: env("INSTAGRAM_API_HOST") ?? "graph.facebook.com" }
        : undefined,
  };
}

export const config = load();

export class ConfigError extends Error {}

export function requireConfig<K extends "linkedin" | "facebook" | "instagram">(platform: K): NonNullable<Config[K]> {
  const c = config[platform];
  if (!c) {
    const hints = {
      linkedin: "LINKEDIN_ACCESS_TOKEN (opcjonalnie LINKEDIN_AUTHOR_URN)",
      facebook: "FACEBOOK_PAGE_ID i FACEBOOK_PAGE_ACCESS_TOKEN",
      instagram: "INSTAGRAM_USER_ID i INSTAGRAM_ACCESS_TOKEN (lub FACEBOOK_PAGE_ACCESS_TOKEN)",
    };
    throw new ConfigError(`${platform} nie jest skonfigurowany. Ustaw zmienne: ${hints[platform]}.`);
  }
  return c as NonNullable<Config[K]>;
}
