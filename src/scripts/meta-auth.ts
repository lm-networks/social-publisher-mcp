/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */
/**
 * Turns a short-lived Meta user token (e.g. from Graph API Explorer) into a
 * non-expiring Page token and finds the linked Instagram account. Usage:
 *   npm run auth:meta -- <short-lived-user-token>
 *   npm run auth:meta -- <token> --page <PAGE_ID> --write
 * Requires META_APP_ID and META_APP_SECRET.
 */
import { flagValue, hasFlag, need, upsertEnv } from "./envfile.js";

const version = process.env.META_GRAPH_API_VERSION ?? "v24.0";
const graph = `https://graph.facebook.com/${version}`;
const appId = need("META_APP_ID");
const appSecret = need("META_APP_SECRET");
const shortToken = process.argv.slice(2).find((a) => !a.startsWith("--") && a !== flagValue("--page")) ?? process.env.META_USER_TOKEN;
if (!shortToken) {
  console.error("Podaj krótkoterminowy token użytkownika: npm run auth:meta -- <token>");
  process.exit(1);
}

async function get(path: string, params: Record<string, string>, token?: string) {
  const res = await fetch(`${graph}/${path}?${new URLSearchParams(params)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? JSON.stringify(data));
  return data;
}

try {
  const { access_token: longUserToken } = await get("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });

  // Page tokens fetched with a long-lived user token do not expire.
  const { data: pages } = await get(
    "me/accounts",
    { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" },
    longUserToken,
  );
  if (!pages?.length) throw new Error("Brak stron — sprawdź uprawnienia pages_show_list i czy jesteś adminem strony.");

  console.log("\nDostępne strony:");
  for (const p of pages) {
    const ig = p.instagram_business_account;
    console.log(`- ${p.name}  FACEBOOK_PAGE_ID=${p.id}${ig ? `  INSTAGRAM_USER_ID=${ig.id} (@${ig.username})` : "  (brak połączonego Instagrama)"}`);
  }

  const chosenId = flagValue("--page") ?? (pages.length === 1 ? pages[0].id : undefined);
  const page = pages.find((p: any) => p.id === chosenId);
  if (!page) {
    console.log("\nWybierz stronę: npm run auth:meta -- <token> --page <PAGE_ID> [--write]");
    process.exit(0);
  }

  const values: Record<string, string> = {
    FACEBOOK_PAGE_ID: page.id,
    FACEBOOK_PAGE_ACCESS_TOKEN: page.access_token,
  };
  if (page.instagram_business_account) values.INSTAGRAM_USER_ID = page.instagram_business_account.id;

  console.log(`\nWybrana strona: ${page.name}`);
  for (const [k, v] of Object.entries(values)) console.log(`${k}=${v}`);
  if (hasFlag("--write")) upsertEnv(values);
} catch (e) {
  console.error("Błąd:", e instanceof Error ? e.message : e);
  process.exit(1);
}
