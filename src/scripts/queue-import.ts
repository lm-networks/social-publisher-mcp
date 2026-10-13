/**
 * social-publisher-mcp — publikacja postów na LinkedIn, Facebook i Instagram
 * Autor: LuMiGRAF Technology Lab — https://dev.lm-ads.com
 * Kontakt: l@lm-networks.pl
 * © 2026 LuMiGRAF Technology Lab
 */
/**
 * Adds a whole content plan to the queue:  npm run queue:import -- plans/plik.json
 * The file is a JSON array of { publish_at, label?, wait_for_link?, platforms, text,
 * platform_text?, images?, instagram_images?, link_url?, include_link_on_instagram?,
 * linkedin_link_in_comment?, linkedin_first_comment? }.
 */
import { readFileSync } from "node:fs";
import { addEntries } from "../queue.js";

const file = process.argv[2];
if (!file) {
  console.error("Użycie: npm run queue:import -- <plik.json>");
  process.exit(1);
}
const items: any[] = JSON.parse(readFileSync(file, "utf8"));
const added = await addEntries(
  items.map((i) => ({
    publishAt: i.publish_at,
    label: i.label,
    waitForLink: i.wait_for_link,
    post: {
      platforms: i.platforms,
      text: i.text,
      platformText: i.platform_text,
      images: i.images,
      instagramImages: i.instagram_images,
      linkUrl: i.link_url,
      includeLinkOnInstagram: i.include_link_on_instagram,
      linkedinLinkInComment: i.linkedin_link_in_comment,
      linkedinFirstComment: i.linkedin_first_comment,
    },
  })),
);
for (const e of added) console.log(`+ ${e.id}  ${e.publishAt}  ${e.post.platforms.join(",")}  ${e.label ?? ""}`);
console.log(`Dodano ${added.length} wpisów do kolejki.`);
