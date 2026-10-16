/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */
/**
 * HTTP mode (node dist/index.js --http):
 *   POST /mcp           MCP Streamable HTTP (stateless), Bearer MCP_AUTH_TOKEN or ?token=
 *   GET  /media/<file>  public files for Instagram (no auth - Meta fetches them)
 *   GET  /health        liveness
 * Also runs the publication queue every SOCIAL_MCP_QUEUE_INTERVAL_MIN minutes (0 = off).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { appendFileSync, createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { notifyTelegram } from "./notify.js";
import { addEntries, cancelEntry, listEntries, QUEUE_FILE, runDue, updateEntry, type NewEntry } from "./queue.js";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

const log = (msg: string) => console.error(`${new Date().toISOString()} ${msg}`);

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, url: URL): boolean {
  const expected = config.http.authToken;
  if (!expected) return true;
  const header = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const given = header ?? url.searchParams.get("token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function serveMedia(res: ServerResponse, pathname: string) {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice("/media/".length));
  } catch {
    return send(res, 400, { error: "bad path" });
  }
  const file = resolve(config.mediaDir, rel);
  const inside = relative(config.mediaDir, file);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) return send(res, 404, { error: "not found" });
  const type = MIME[extname(file).toLowerCase()];
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile() || !type) return send(res, 404, { error: "not found" });
    size = st.size;
  } catch {
    return send(res, 404, { error: "not found" });
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "cache-control": "public, max-age=3600" });
  createReadStream(file).pipe(res);
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, buildServer: () => McpServer) {
  if (req.method !== "POST") {
    // Stateless server: no standalone SSE stream and no sessions to delete.
    res.writeHead(405, { allow: "POST", "content-type": "application/json" });
    return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
  }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

/**
 * REST for the admin panel (lm-networks.pl/admin/social.php), same Bearer token as /mcp:
 *   GET  /api/queue               all entries, sorted by publishAt
 *   POST /api/queue               { publishAt, label?, waitForLink?, post } -> created entry
 *   PATCH /api/queue/<id>         { publishAt?, label?, waitForLink?, post? } (pending only)
 *   POST /api/queue/<id>/cancel   cancel a pending entry
 */
async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const parts = pathname.split("/").filter(Boolean); // ["api","queue",id?,action?]
  if (parts[1] !== "queue") return send(res, 404, { error: "not found" });
  const id = parts[2];
  try {
    if (!id && req.method === "GET") return send(res, 200, listEntries());
    if (!id && req.method === "POST") {
      const body = (await readJson(req)) as NewEntry;
      const [created] = await addEntries([body]);
      log(`api: dodano ${created.id} ${created.label ?? ""}`);
      return send(res, 201, created);
    }
    if (id && !parts[3] && req.method === "PATCH") {
      const e = await updateEntry(id, await readJson(req));
      log(`api: zmieniono ${id}`);
      return send(res, 200, e);
    }
    if (id && parts[3] === "cancel" && req.method === "POST") {
      const e = await cancelEntry(id);
      log(`api: anulowano ${id}`);
      return send(res, 200, e);
    }
    return send(res, 405, { error: "method not allowed" });
  } catch (e) {
    return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

function startQueueTimer() {
  const minutes = Number(process.env.SOCIAL_MCP_QUEUE_INTERVAL_MIN ?? 5);
  if (!minutes) return;
  const tick = async () => {
    try {
      const reports = await runDue();
      if (!reports.length) return;
      const stamp = new Date().toISOString();
      const lines = reports.map((r) => {
        const urls = r.results
          ?.map((x) => (x.ok ? `${x.platform}: ${x.url ?? x.id ?? "ok"}` : `${x.platform}: BŁĄD ${x.error}`))
          .join("; ");
        return `${stamp} [${r.outcome}] ${r.id} ${r.label ?? ""} ${urls ?? r.note ?? ""}`.trim();
      });
      appendFileSync(`${QUEUE_FILE}.log`, lines.join("\n") + "\n");
      lines.forEach((l) => console.error(l));
      await notifyTelegram(reports).catch((e) => log(`telegram: ${e instanceof Error ? e.message : String(e)}`));
    } catch (e) {
      log(`kolejka: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  setInterval(tick, minutes * 60_000);
  setTimeout(tick, 10_000);
  log(`kolejka publikacji co ${minutes} min (${QUEUE_FILE})`);
}

export function startHttpServer(buildServer: () => McpServer) {
  const { host, port, authToken } = config.http;
  if (!authToken && host !== "127.0.0.1" && host !== "localhost")
    throw new Error("MCP_AUTH_TOKEN jest wymagany, gdy serwer nasłuchuje poza localhost.");

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/health") return send(res, 200, { ok: true });
      if (url.pathname.startsWith("/media/") && (req.method === "GET" || req.method === "HEAD"))
        return serveMedia(res, url.pathname);
      if (url.pathname === "/mcp") {
        if (!authorized(req, url)) {
          res.setHeader("www-authenticate", "Bearer");
          return send(res, 401, { error: "unauthorized" });
        }
        return await handleMcp(req, res, buildServer);
      }
      if (url.pathname.startsWith("/api/")) {
        if (!authorized(req, url)) return send(res, 401, { error: "unauthorized" });
        return await handleApi(req, res, url.pathname);
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      log(`błąd ${req.method} ${url.pathname}: ${e instanceof Error ? e.stack : String(e)}`);
      if (!res.headersSent) send(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });

  http.listen(port, host, () => {
    log(`social-publisher MCP działa (http://${host}:${port}/mcp, media: ${config.mediaDir})`);
    if (config.publicUrl) log(`publiczny adres: ${config.publicUrl}`);
  });
  startQueueTimer();
}
