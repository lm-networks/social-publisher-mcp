/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

export type Platform = "linkedin" | "facebook" | "instagram";

export interface PublishResult {
  platform: Platform;
  dryRun: boolean;
  id?: string;
  url?: string;
  /** For dry runs: what would be sent (without tokens). */
  plan?: unknown;
  scheduledFor?: string;
}
