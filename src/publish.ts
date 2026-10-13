/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { requireConfig } from "./config.js";
import * as facebook from "./platforms/facebook.js";
import * as instagram from "./platforms/instagram.js";
import * as linkedin from "./platforms/linkedin.js";
import type { Platform, PublishResult } from "./types.js";

export interface CrossPost {
  platforms: Platform[];
  text: string;
  platformText?: Partial<Record<Platform, string>>;
  images?: string[];
  /** Instagram accepts only public JPEG URLs; use this when `images` are PNG or local files. */
  instagramImages?: string[];
  linkUrl?: string;
  includeLinkOnInstagram?: boolean;
  /** LinkedIn: link in the first comment instead of the post body. */
  linkedinLinkInComment?: boolean;
  /** LinkedIn: custom first-comment text. */
  linkedinFirstComment?: string;
}

export type CrossPostResult =
  | (PublishResult & { ok: true })
  | { platform: Platform; ok: false; error: string };

/** Publishes to each platform independently; one failure does not block the others. */
export async function crossPost(post: CrossPost, dryRun: boolean): Promise<CrossPostResult[]> {
  const textFor = (p: Platform) => post.platformText?.[p] ?? post.text;
  const jobs: Record<Platform, () => Promise<PublishResult>> = {
    linkedin: () =>
      linkedin.createPost(requireConfig("linkedin"), {
        text: textFor("linkedin"),
        images: post.images,
        linkUrl: post.linkUrl,
        linkInFirstComment: post.linkedinLinkInComment,
        firstComment: post.linkedinFirstComment,
        dryRun,
      }),
    facebook: () =>
      facebook.createPost(requireConfig("facebook"), {
        text: textFor("facebook"),
        images: post.images,
        linkUrl: post.linkUrl,
        dryRun,
      }),
    instagram: () => {
      const caption =
        post.includeLinkOnInstagram && post.linkUrl ? `${textFor("instagram")}\n\n${post.linkUrl}` : textFor("instagram");
      return instagram.createPost(requireConfig("instagram"), {
        caption,
        images: post.instagramImages ?? post.images,
        dryRun,
      });
    },
  };
  const platforms = [...new Set(post.platforms)];
  const settled = await Promise.allSettled(platforms.map((p) => jobs[p]()));
  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? { ...s.value, ok: true as const }
      : { platform: platforms[i], ok: false as const, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
  );
}
