// E2E check that a saved ("Save Page As…") NYT Mini page is playable with the
// extension loaded. Usage:
//   bun tools/verify-mini-saved.ts "/path/to/... The Mini puzzle — The New York Times.html"
// Needs a Chromium that still supports --load-extension (branded Chrome 137+
// does not); defaults to Playwright's cached Chrome for Testing.
import { chromium } from "playwright-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const savedPage = process.argv[2];
if (!savedPage) {
  console.error("usage: bun tools/verify-mini-saved.ts <saved-mini.html>");
  process.exit(2);
}
const EXT = new URL("..", import.meta.url).pathname;
const CHROMIUM =
  process.env.CHROMIUM_PATH ??
  "/Users/spaceparanoids/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "tijeux-verify-")), {
  executablePath: CHROMIUM,
  headless: false,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run"],
});
const page = await ctx.newPage();
page.on("console", (m) => m.text().includes("[tijeux]") && console.log(m.text()));
await page.goto(`file://${savedPage}`);
await page.waitForTimeout(8000);

const cells = await page.locator("[class*=xwd__cell]").count();
const oops = await page.locator("text=Oops").count();
const subscribe = await page.locator("text=Subscribe to play").count();
await ctx.close();

console.log({ cells, oops, subscribe });
const pass = cells > 0 && oops === 0 && subscribe === 0;
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
