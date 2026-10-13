#!/usr/bin/env node
/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config, requireConfig } from "./config.js";
import * as facebook from "./platforms/facebook.js";
import * as instagram from "./platforms/instagram.js";
import * as linkedin from "./platforms/linkedin.js";
import type { Platform, PublishResult } from "./types.js";

const server = new McpServer({ name: "social-publisher", version: "1.0.0" });

const ok = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
});

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

const publishAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const dryRun = z
  .boolean()
  .optional()
  .describe("true = tylko pokaż, co zostałoby wysłane, bez publikacji. Domyślnie wg SOCIAL_MCP_DRY_RUN.");

const mediaList = (what: string) =>
  z.array(z.string().min(1)).optional().describe(what);

// ---------------------------------------------------------------- check_connections

server.registerTool(
  "check_connections",
  {
    title: "Sprawdź połączenia",
    description:
      "Sprawdza, które platformy (LinkedIn, Facebook, Instagram) są skonfigurowane i czy tokeny działają. Zwraca konto/stronę, na którą będą publikowane posty.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () =>
    run(async () => {
      const check = async (name: Platform, fn: () => Promise<unknown>) => {
        if (!config[name]) return [name, { configured: false }] as const;
        try {
          return [name, { configured: true, ok: true, account: await fn() }] as const;
        } catch (e) {
          return [name, { configured: true, ok: false, error: e instanceof Error ? e.message : String(e) }] as const;
        }
      };
      const results = await Promise.all([
        check("linkedin", () => linkedin.whoAmI(config.linkedin!)),
        check("facebook", () => facebook.whoAmI(config.facebook!)),
        check("instagram", () => instagram.whoAmI(config.instagram!)),
      ]);
      return { dryRunByDefault: config.dryRunByDefault, ...Object.fromEntries(results) };
    }),
);

// ---------------------------------------------------------------- LinkedIn

server.registerTool(
  "linkedin_create_post",
  {
    title: "Opublikuj post na LinkedIn",
    description:
      "Publikuje post na LinkedIn (profil osobisty lub strona firmowa). Obsługuje: sam tekst, tekst + link (karta artykułu), tekst + 1–20 zdjęć. Hashtagi (#tag) są automatycznie zamieniane na klikalne. LinkedIn API nie obsługuje planowania publikacji.",
    inputSchema: {
      text: z.string().min(1).max(linkedin.LINKEDIN_MAX_TEXT).describe("Treść posta (do 3000 znaków)."),
      images: mediaList("Zdjęcia: publiczne URL-e lub ścieżki do plików lokalnych (JPG/PNG/GIF), maks. 20."),
      image_alt_text: z.string().max(4086).optional().describe("Tekst alternatywny dla zdjęć."),
      link_url: z.string().url().optional().describe("Link do udostępnienia (bez zdjęć → karta artykułu, ze zdjęciami → link w treści)."),
      link_title: z.string().optional().describe("Tytuł karty linku (domyślnie sam URL)."),
      link_description: z.string().optional().describe("Opis karty linku."),
      link_thumbnail: z.string().optional().describe("Miniatura karty linku: URL lub ścieżka lokalna. LinkedIn sam jej nie pobiera."),
      visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional().describe("PUBLIC (domyślnie) lub CONNECTIONS (tylko profil osobisty)."),
      author_urn: z
        .string()
        .regex(/^urn:li:(person|organization):.+$/)
        .optional()
        .describe("Nadpisuje autora, np. urn:li:organization:123456. Domyślnie LINKEDIN_AUTHOR_URN lub zalogowany użytkownik."),
      dry_run: dryRun,
    },
    annotations: publishAnnotations,
  },
  async (a) =>
    run(() =>
      linkedin.createPost(requireConfig("linkedin"), {
        text: a.text,
        images: a.images,
        imageAltText: a.image_alt_text,
        linkUrl: a.link_url,
        linkTitle: a.link_title,
        linkDescription: a.link_description,
        linkThumbnail: a.link_thumbnail,
        visibility: a.visibility,
        authorUrn: a.author_urn,
        dryRun: a.dry_run ?? config.dryRunByDefault,
      }),
    ),
);

// ---------------------------------------------------------------- Facebook

server.registerTool(
  "facebook_create_post",
  {
    title: "Opublikuj post na Facebooku",
    description:
      "Publikuje post na stronie na Facebooku (Page). Obsługuje: tekst, link, 1–10 zdjęć albo jedno wideo. Można zaplanować publikację (scheduled_at, 10 min – 30 dni do przodu).",
    inputSchema: {
      text: z.string().max(63206).optional().describe("Treść posta."),
      link_url: z.string().url().optional().describe("Link (bez zdjęć → podgląd linku, ze zdjęciami → link w treści)."),
      images: mediaList("Zdjęcia: publiczne URL-e lub ścieżki lokalne, maks. 10."),
      video: z.string().optional().describe("Wideo: publiczny URL lub ścieżka lokalna (MP4/MOV). Wyklucza zdjęcia."),
      video_title: z.string().optional().describe("Tytuł wideo."),
      scheduled_at: z
        .string()
        .optional()
        .describe("Zaplanowana publikacja w ISO 8601, np. 2026-10-20T09:00:00+02:00."),
      dry_run: dryRun,
    },
    annotations: publishAnnotations,
  },
  async (a) =>
    run(() =>
      facebook.createPost(requireConfig("facebook"), {
        text: a.text,
        linkUrl: a.link_url,
        images: a.images,
        video: a.video,
        videoTitle: a.video_title,
        scheduledAt: a.scheduled_at,
        dryRun: a.dry_run ?? config.dryRunByDefault,
      }),
    ),
);

// ---------------------------------------------------------------- Instagram

server.registerTool(
  "instagram_create_post",
  {
    title: "Opublikuj post na Instagramie",
    description:
      "Publikuje na koncie Instagram Business/Creator: pojedyncze zdjęcie, karuzelę (2–10 zdjęć/wideo) lub Reels (video). Wymaga publicznych URL-i https (JPEG dla zdjęć, MP4 dla wideo) — pliki lokalne nie są obsługiwane przez API. Linki w opisie nie są klikalne. Maks. 2200 znaków i 30 hashtagów.",
    inputSchema: {
      caption: z.string().max(instagram.INSTAGRAM_MAX_CAPTION).optional().describe("Opis posta."),
      images: mediaList("Publiczne URL-e zdjęć (JPEG). 1 = zwykły post, 2–10 = karuzela (pozycje .mp4/.mov jako wideo)."),
      video: z.string().url().optional().describe("Publiczny URL wideo MP4 → publikacja jako Reels."),
      alt_text: z.string().optional().describe("Tekst alternatywny dla zdjęć."),
      share_reel_to_feed: z.boolean().optional().describe("Czy Reels ma się pojawić też w siatce profilu (domyślnie true)."),
      dry_run: dryRun,
    },
    annotations: publishAnnotations,
  },
  async (a) =>
    run(() =>
      instagram.createPost(requireConfig("instagram"), {
        caption: a.caption,
        images: a.images,
        video: a.video,
        altText: a.alt_text,
        shareReelToFeed: a.share_reel_to_feed,
        dryRun: a.dry_run ?? config.dryRunByDefault,
      }),
    ),
);

// ---------------------------------------------------------------- cross-posting

server.registerTool(
  "social_publish",
  {
    title: "Opublikuj na wielu platformach",
    description:
      "Publikuje ten sam post (tekst + opcjonalnie zdjęcia i link) na wybranych platformach naraz. Każda platforma jest publikowana niezależnie — błąd jednej nie blokuje pozostałych. Instagram wymaga co najmniej jednego zdjęcia z publicznym URL. Treść można dopasować per platforma w platform_text.",
    inputSchema: {
      platforms: z.array(z.enum(["linkedin", "facebook", "instagram"])).min(1).describe("Docelowe platformy."),
      text: z.string().min(1).describe("Wspólna treść posta."),
      platform_text: z
        .object({ linkedin: z.string(), facebook: z.string(), instagram: z.string() })
        .partial()
        .optional()
        .describe("Opcjonalna treść dla konkretnej platformy (nadpisuje text)."),
      images: mediaList("Zdjęcia (publiczne URL-e; ścieżki lokalne działają tylko dla LinkedIn i Facebooka)."),
      link_url: z.string().url().optional().describe("Link. Na Instagramie dopisywany do opisu tylko jeśli include_link_on_instagram."),
      include_link_on_instagram: z.boolean().optional().describe("Dopisz link do opisu na Instagramie (nieklikalny). Domyślnie false."),
      dry_run: dryRun,
    },
    annotations: publishAnnotations,
  },
  async (a) => {
    const dry = a.dry_run ?? config.dryRunByDefault;
    const textFor = (p: Platform) => a.platform_text?.[p] ?? a.text;
    const jobs: Record<Platform, () => Promise<PublishResult>> = {
      linkedin: () =>
        linkedin.createPost(requireConfig("linkedin"), { text: textFor("linkedin"), images: a.images, linkUrl: a.link_url, dryRun: dry }),
      facebook: () =>
        facebook.createPost(requireConfig("facebook"), { text: textFor("facebook"), images: a.images, linkUrl: a.link_url, dryRun: dry }),
      instagram: () => {
        const caption =
          a.include_link_on_instagram && a.link_url ? `${textFor("instagram")}\n\n${a.link_url}` : textFor("instagram");
        return instagram.createPost(requireConfig("instagram"), { caption, images: a.images, dryRun: dry });
      },
    };
    const platforms = [...new Set(a.platforms)];
    const settled = await Promise.allSettled(platforms.map((p) => jobs[p]()));
    const results = settled.map((s, i) =>
      s.status === "fulfilled"
        ? { ...s.value, ok: true }
        : { platform: platforms[i], ok: false, error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
    );
    const anyOk = results.some((r) => r.ok);
    return { ...ok({ results }), isError: !anyOk };
  },
);

await server.connect(new StdioServerTransport());
console.error("social-publisher MCP działa (stdio)");
