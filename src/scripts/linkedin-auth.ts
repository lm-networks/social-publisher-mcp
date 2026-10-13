/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */
/**
 * OAuth 2.0 (3-legged) flow for LinkedIn. Usage:
 *   npm run auth:linkedin            – print the token
 *   npm run auth:linkedin -- --write – also save it to .env
 * Requires LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET and the redirect URL
 * http://localhost:8765/callback registered in the LinkedIn app (Auth tab).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { hasFlag, need, upsertEnv } from "./envfile.js";

const clientId = need("LINKEDIN_CLIENT_ID");
const clientSecret = need("LINKEDIN_CLIENT_SECRET");
const port = Number(process.env.LINKEDIN_REDIRECT_PORT ?? 8765);
const redirectUri = `http://localhost:${port}/callback`;
// w_organization_social (company pages) needs the Community Management API product.
const scopes = process.env.LINKEDIN_SCOPES ?? "openid profile w_member_social";
const state = randomBytes(16).toString("hex");

const authUrl =
  "https://www.linkedin.com/oauth/v2/authorization?" +
  new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: scopes, state });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  if (url.pathname !== "/callback") return void res.writeHead(404).end();
  const done = (msg: string) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<p>${msg}</p><p>Możesz zamknąć to okno.</p>`);
    server.close();
  };
  try {
    if (url.searchParams.get("state") !== state) throw new Error("Niezgodny parametr state.");
    const error = url.searchParams.get("error");
    if (error) throw new Error(`${error}: ${url.searchParams.get("error_description")}`);

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: url.searchParams.get("code") ?? "",
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(JSON.stringify(token));

    const values: Record<string, string> = { LINKEDIN_ACCESS_TOKEN: token.access_token };
    const me = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }).then((r) => (r.ok ? r.json() : undefined));
    if (me?.sub && !process.env.LINKEDIN_AUTHOR_URN) values.LINKEDIN_AUTHOR_URN = `urn:li:person:${me.sub}`;

    const days = Math.round((token.expires_in ?? 0) / 86400);
    console.log(`\nToken ważny ok. ${days} dni${me?.name ? ` — konto: ${me.name}` : ""}.`);
    for (const [k, v] of Object.entries(values)) console.log(`${k}=${v}`);
    if (hasFlag("--write")) upsertEnv(values);
    done("Gotowe — token LinkedIn uzyskany.");
  } catch (e) {
    console.error("Błąd:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
    done("Błąd autoryzacji — szczegóły w terminalu.");
  }
});

server.listen(port, () => {
  console.log(`Otwórz w przeglądarce, jeśli nie otworzyła się sama:\n${authUrl}\n`);
  // rundll32 instead of "cmd /c start": cmd would split the URL at every "&".
  const [cmd, args]: [string, string[]] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", authUrl]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [authUrl]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
});
