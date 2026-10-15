// Builds the Firefox add-on into dist/firefox and packs it as dist/ti-jeux-firefox.xpi.
// The scripts are shared with Chrome; only the manifest changes:
// - Firefox has no background service worker, so it gets an event page.
// - Firefox needs an add-on ID for storage.sync and for signing.
// - Content scripts with "world": "MAIN" need Firefox 128.
import { $ } from "bun";

const out = "dist/firefox";
const manifest = await Bun.file("manifest.json").json();

manifest.background = { scripts: ["scripts/sites.js", "scripts/background.js"] };
manifest.options_ui = { page: manifest.options_page, open_in_tab: true };
delete manifest.options_page;
manifest.browser_specific_settings = {
  gecko: {
    id: "ti-jeux@doumart.github.io",
    strict_min_version: "128.0",
    data_collection_permissions: { required: ["none"] },
  },
};

await $`rm -rf ${out} dist/ti-jeux-firefox.xpi && mkdir -p ${out}`;
await $`cp -R icons scripts ui ${out}/`;
await Bun.write(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
await $`cd ${out} && zip -qr ../ti-jeux-firefox.xpi .`;

console.log(`Built ${out} and dist/ti-jeux-firefox.xpi`);
