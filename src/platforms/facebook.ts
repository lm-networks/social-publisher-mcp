/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { config, type FacebookConfig } from "../config.js";
import { isUrl, loadMedia } from "../media.js";
import type { PublishResult } from "../types.js";
import { GraphClient } from "./graph.js";

const VIDEO_HOST = "graph-video.facebook.com";

const client = (cfg: FacebookConfig) => new GraphClient("facebook", "graph.facebook.com", config.graphVersion, cfg.pageAccessToken);

export async function whoAmI(cfg: FacebookConfig) {
  return client(cfg).get(cfg.pageId, { fields: "id,name,link" });
}

export interface FacebookPostInput {
  text?: string;
  linkUrl?: string;
  images?: string[];
  video?: string;
  videoTitle?: string;
  scheduledAt?: string;
  dryRun: boolean;
}

/** Scheduled posts must be 10 min – 30 days ahead (Graph API limit). */
function scheduleParams(scheduledAt?: string) {
  if (!scheduledAt) return {};
  const ts = Date.parse(scheduledAt);
  if (Number.isNaN(ts)) throw new Error(`[facebook] Niepoprawna data scheduled_at: ${scheduledAt} (użyj ISO 8601).`);
  const ahead = ts - Date.now();
  if (ahead < 10 * 60_000 || ahead > 30 * 24 * 3600_000)
    throw new Error("[facebook] scheduled_at musi być od 10 minut do 30 dni w przyszłości.");
  return { published: false, scheduled_publish_time: Math.floor(ts / 1000) };
}

async function mediaForm(src: string, fields: Record<string, string | number | boolean | undefined>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, String(v));
  const m = await loadMedia(src);
  form.append("source", new Blob([m.data], { type: m.contentType }), m.filename);
  return form;
}

export async function createPost(cfg: FacebookConfig, input: FacebookPostInput): Promise<PublishResult> {
  const images = input.images ?? [];
  if (images.length > 10) throw new Error("[facebook] Maksymalnie 10 zdjęć w jednym poście.");
  if (input.video && images.length) throw new Error("[facebook] Post może zawierać wideo albo zdjęcia, nie oba naraz.");
  if (!input.text && !input.linkUrl && !images.length && !input.video)
    throw new Error("[facebook] Post musi mieć tekst, link, zdjęcie lub wideo.");

  const fb = client(cfg);
  const schedule = scheduleParams(input.scheduledAt);
  let message = input.text;
  // Photo/video posts have no link card, so put the link into the text.
  if ((images.length || input.video) && input.linkUrl && !message?.includes(input.linkUrl))
    message = [message, input.linkUrl].filter(Boolean).join("\n\n");

  const page = cfg.pageId;
  const result = (id: string | undefined, url?: string): PublishResult => ({
    platform: "facebook",
    dryRun: false,
    id,
    url,
    scheduledFor: input.scheduledAt,
  });
  const permalink = async (id: string) =>
    (await fb.get(id, { fields: "permalink_url" }).catch(() => undefined))?.permalink_url ?? `https://www.facebook.com/${id}`;

  // --- video ---
  if (input.video) {
    const fields = { description: message, title: input.videoTitle, ...schedule };
    if (input.dryRun)
      return { platform: "facebook", dryRun: true, plan: { POST: fb.url(`${page}/videos`, VIDEO_HOST), fields, video: input.video } };
    const res = isUrl(input.video)
      ? await fb.post(`${page}/videos`, { ...fields, file_url: input.video }, VIDEO_HOST)
      : await fb.postMultipart(`${page}/videos`, await mediaForm(input.video, fields), VIDEO_HOST);
    return result(res.id, `https://www.facebook.com/${res.id}`);
  }

  // --- single photo ---
  if (images.length === 1) {
    const fields = { message, ...schedule };
    if (input.dryRun)
      return { platform: "facebook", dryRun: true, plan: { POST: fb.url(`${page}/photos`), fields, image: images[0] } };
    const res = isUrl(images[0])
      ? await fb.post(`${page}/photos`, { ...fields, url: images[0] })
      : await fb.postMultipart(`${page}/photos`, await mediaForm(images[0], fields));
    const id = res.post_id ?? res.id;
    return result(id, await permalink(id));
  }

  // --- text / link / multi-photo ---
  const feed: Record<string, string | number | boolean | undefined> = {
    message,
    link: images.length ? undefined : input.linkUrl,
    ...schedule,
  };
  if (input.dryRun)
    return {
      platform: "facebook",
      dryRun: true,
      plan: { uploadUnpublishedPhotos: images, POST: fb.url(`${page}/feed`), fields: feed },
    };

  for (const [i, src] of images.entries()) {
    // Unpublished photos are attached to the feed post; "temporary" is required for scheduled posts.
    const fields = { published: false, temporary: schedule.published === false ? true : undefined };
    const photo = isUrl(src)
      ? await fb.post(`${page}/photos`, { ...fields, url: src })
      : await fb.postMultipart(`${page}/photos`, await mediaForm(src, fields));
    feed[`attached_media[${i}]`] = JSON.stringify({ media_fbid: photo.id });
  }
  const res = await fb.post(`${page}/feed`, feed);
  return result(res.id, await permalink(res.id));
}
