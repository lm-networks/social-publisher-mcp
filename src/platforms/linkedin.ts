/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import type { LinkedInConfig } from "../config.js";
import { ApiError, requestJson } from "../http.js";
import { loadMedia } from "../media.js";
import type { PublishResult } from "../types.js";

const REST = "https://api.linkedin.com/rest";
const P = "linkedin";

export const LINKEDIN_MAX_TEXT = 3000;

let workingVersion: string | undefined;
let cachedAuthor: string | undefined;

/** LinkedIn versions are YYYYMM and each is retired ~1 year after release. */
function candidateVersions(cfg: LinkedInConfig): string[] {
  if (cfg.apiVersion) return [cfg.apiVersion];
  if (workingVersion) return [workingVersion];
  const now = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function isVersionError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  const code = String((e.details as any)?.code ?? "");
  return e.status === 426 || code.includes("VERSION");
}

async function rest(cfg: LinkedInConfig, path: string, init: RequestInit = {}) {
  let lastError: unknown;
  for (const version of candidateVersions(cfg)) {
    try {
      const res = await requestJson(P, `${REST}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          "LinkedIn-Version": version,
          "X-Restli-Protocol-Version": "2.0.0",
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
      workingVersion = version;
      return res;
    } catch (e) {
      if (!isVersionError(e)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export async function getAuthorUrn(cfg: LinkedInConfig): Promise<string> {
  if (cfg.authorUrn) return cfg.authorUrn;
  if (cachedAuthor) return cachedAuthor;
  // Requires the "openid" + "profile" scopes (Sign In with LinkedIn using OpenID Connect).
  const { data } = await requestJson(P, "https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
  });
  if (!data?.sub) throw new Error("[linkedin] Nie udało się ustalić autora — ustaw LINKEDIN_AUTHOR_URN.");
  cachedAuthor = `urn:li:person:${data.sub}`;
  return cachedAuthor;
}

export async function whoAmI(cfg: LinkedInConfig) {
  const author = await getAuthorUrn(cfg);
  let name: string | undefined;
  if (author.startsWith("urn:li:person:")) {
    const { data } = await requestJson(P, "https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
    }).catch(() => ({ data: undefined }));
    name = data?.name;
  }
  return { author, name };
}

async function uploadImage(cfg: LinkedInConfig, owner: string, src: string): Promise<string> {
  const media = await loadMedia(src);
  const { data } = await rest(cfg, "/images?action=initializeUpload", {
    method: "POST",
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const { uploadUrl, image } = data.value;
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${cfg.accessToken}`, "Content-Type": "application/octet-stream" },
    body: media.data,
    signal: AbortSignal.timeout(300_000),
  });
  if (!put.ok) throw new ApiError(P, put.status, `Upload obrazu ${media.filename} nieudany: ${await put.text()}`);
  return image as string;
}

/**
 * Converts plain text to LinkedIn "little text": reserved characters must be escaped,
 * otherwise LinkedIn silently truncates the post (e.g. at the first parenthesis).
 * Hashtags (#word) are turned into hashtag templates so they stay clickable.
 */
export function toLittleText(text: string): string {
  const escape = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(/(?<![\p{L}\p{N}_])#([\p{L}\p{N}_]+)/gu)) {
    out += escape(text.slice(last, m.index)) + `{hashtag|\\#|${m[1]}}`;
    last = m.index! + m[0].length;
  }
  return out + escape(text.slice(last));
}

export interface LinkedInPostInput {
  text: string;
  images?: string[];
  imageAltText?: string;
  linkUrl?: string;
  linkTitle?: string;
  linkDescription?: string;
  linkThumbnail?: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
  authorUrn?: string;
  dryRun: boolean;
}

export async function createPost(cfg: LinkedInConfig, input: LinkedInPostInput): Promise<PublishResult> {
  const images = input.images ?? [];
  if (images.length > 20) throw new Error("[linkedin] Maksymalnie 20 obrazów w poście.");

  let text = input.text;
  // A post carries either images or a link card. With images, the link goes into the text.
  if (images.length && input.linkUrl && !text.includes(input.linkUrl)) text = `${text}\n\n${input.linkUrl}`;
  if (text.length > LINKEDIN_MAX_TEXT) throw new Error(`[linkedin] Tekst ma ${text.length} znaków (limit ${LINKEDIN_MAX_TEXT}).`);

  const author = input.authorUrn ?? (input.dryRun ? cfg.authorUrn ?? "<urn z /v2/userinfo>" : await getAuthorUrn(cfg));
  const upload = (src: string) => (input.dryRun ? Promise.resolve(`<urn:li:image dla ${src}>`) : uploadImage(cfg, author, src));

  let content: Record<string, unknown> | undefined;
  if (images.length === 1) {
    content = { media: { id: await upload(images[0]), altText: input.imageAltText } };
  } else if (images.length > 1) {
    const ids: string[] = [];
    for (const src of images) ids.push(await upload(src));
    content = { multiImage: { images: ids.map((id) => ({ id, altText: input.imageAltText })) } };
  } else if (input.linkUrl) {
    content = {
      article: {
        source: input.linkUrl,
        title: input.linkTitle ?? input.linkUrl,
        description: input.linkDescription,
        thumbnail: input.linkThumbnail ? await upload(input.linkThumbnail) : undefined,
      },
    };
  }

  const body = {
    author,
    commentary: toLittleText(text),
    visibility: input.visibility ?? "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    content,
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (input.dryRun) return { platform: "linkedin", dryRun: true, plan: { POST: `${REST}/posts`, body } };

  const res = await rest(cfg, "/posts", { method: "POST", body: JSON.stringify(body) });
  const id = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? undefined;
  return {
    platform: "linkedin",
    dryRun: false,
    id,
    url: id ? `https://www.linkedin.com/feed/update/${id}/` : undefined,
  };
}
