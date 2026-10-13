/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { config, type InstagramConfig } from "../config.js";
import { sleep } from "../http.js";
import { isUrl, isVideo, publicMediaUrl } from "../media.js";
import type { PublishResult } from "../types.js";
import { GraphClient } from "./graph.js";

export const INSTAGRAM_MAX_CAPTION = 2200;
export const INSTAGRAM_MAX_HASHTAGS = 30;

const client = (cfg: InstagramConfig) => new GraphClient("instagram", cfg.host, config.graphVersion, cfg.accessToken);

export async function whoAmI(cfg: InstagramConfig) {
  return client(cfg).get(cfg.userId, { fields: "id,username" });
}

export interface InstagramPostInput {
  caption?: string;
  images?: string[];
  video?: string;
  altText?: string;
  shareReelToFeed?: boolean;
  dryRun: boolean;
}

/** Media containers are processed asynchronously; publishing before FINISHED fails. */
async function waitUntilReady(ig: GraphClient, containerId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const { status_code, status } = await ig.get(containerId, { fields: "status_code,status" });
    if (status_code === "FINISHED" || status_code === "PUBLISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED")
      throw new Error(`[instagram] Przetwarzanie mediów nieudane (${status_code}): ${status ?? "brak szczegółów"}`);
    if (Date.now() > deadline) throw new Error(`[instagram] Przekroczono czas oczekiwania na kontener ${containerId}.`);
    await sleep(3000);
  }
}

export function validateCaption(caption = "") {
  if (caption.length > INSTAGRAM_MAX_CAPTION)
    throw new Error(`[instagram] Opis ma ${caption.length} znaków (limit ${INSTAGRAM_MAX_CAPTION}).`);
  const tags = caption.match(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  if (tags > INSTAGRAM_MAX_HASHTAGS) throw new Error(`[instagram] ${tags} hashtagów (limit ${INSTAGRAM_MAX_HASHTAGS}).`);
}

export async function createPost(cfg: InstagramConfig, input: InstagramPostInput): Promise<PublishResult> {
  if (!input.images?.length && !input.video) throw new Error("[instagram] Instagram wymaga zdjęcia lub wideo — sam tekst nie jest możliwy.");
  if (input.images?.length && input.video) throw new Error("[instagram] Podaj zdjęcia (pojedyncze/karuzela) albo jedno wideo (Reels).");
  if ((input.images?.length ?? 0) > 10) throw new Error("[instagram] Karuzela może mieć maksymalnie 10 elementów.");
  // Local paths become /media/ URLs when SOCIAL_MCP_PUBLIC_URL is set.
  const images = await Promise.all((input.images ?? []).map(publicMediaUrl));
  input = { ...input, video: input.video && (await publicMediaUrl(input.video)) };
  const local = [...images, input.video].filter((s): s is string => !!s && !isUrl(s));
  if (local.length)
    throw new Error(
      `[instagram] API Instagrama przyjmuje tylko publiczne adresy URL (https), nie pliki lokalne: ${local.join(", ")}. Ustaw SOCIAL_MCP_PUBLIC_URL albo użyj upload_media.`,
    );
  validateCaption(input.caption);

  const ig = client(cfg);
  const user = cfg.userId;
  const caption = input.caption;

  let containerFields: Record<string, string | boolean | undefined>;
  let children: Record<string, string | boolean | undefined>[] = [];
  let timeout = 120_000;

  if (input.video) {
    containerFields = { media_type: "REELS", video_url: input.video, caption, share_to_feed: input.shareReelToFeed ?? true };
    timeout = 900_000;
  } else if (images.length === 1) {
    containerFields = { image_url: images[0], caption, alt_text: input.altText };
  } else {
    children = images.map((src) =>
      isVideo(src)
        ? { media_type: "VIDEO", video_url: src, is_carousel_item: true }
        : { image_url: src, is_carousel_item: true, alt_text: input.altText },
    );
    if (children.some((c) => c.media_type === "VIDEO")) timeout = 900_000;
    containerFields = { media_type: "CAROUSEL", caption };
  }

  if (input.dryRun)
    return {
      platform: "instagram",
      dryRun: true,
      plan: {
        carouselItems: children.length ? children.map((c) => ({ POST: ig.url(`${user}/media`), fields: c })) : undefined,
        container: { POST: ig.url(`${user}/media`), fields: containerFields },
        publish: { POST: ig.url(`${user}/media_publish`), fields: { creation_id: "<id kontenera>" } },
      },
    };

  if (children.length) {
    const ids: string[] = [];
    for (const child of children) ids.push((await ig.post(`${user}/media`, child)).id);
    for (const id of ids) await waitUntilReady(ig, id, timeout);
    containerFields.children = ids.join(",");
  }

  const container = await ig.post(`${user}/media`, containerFields);
  await waitUntilReady(ig, container.id, timeout);
  const published = await ig.post(`${user}/media_publish`, { creation_id: container.id });
  const media = await ig.get(published.id, { fields: "permalink" }).catch(() => undefined);
  return { platform: "instagram", dryRun: false, id: published.id, url: media?.permalink };
}
