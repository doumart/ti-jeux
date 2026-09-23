// End-to-end against a running preview container:
//   docker run --rm --shm-size=1g -p 127.0.0.1:3000:3000 -e LOCAL_PREVIEW=1 -e PREVIEW_HOST=0.0.0.0 tijeux-cloud
// Checks real video/audio from the cloud browser, the extension's game status and host input.
// Viewer lockout and input validation are covered by bun test.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright-core';

declare const document: any; // evaluated in the page

const origin = process.env.ACTIVITY_URL || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), args: ['--autoplay-policy=no-user-gesture-required'] });
const errors: string[] = [];
const open = async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
};
const frames = (page: Page) => page.evaluate(() => document.querySelector('video')!.getVideoPlaybackQuality().totalVideoFrames);
const waitVideo = (page: Page) => page.waitForFunction(() => {
  const v = document.querySelector('video')!;
  return v.videoWidth === 1280 && v.currentTime > 0.5 && v.getVideoPlaybackQuality().totalVideoFrames > 5;
}, null, { timeout: 60_000 });
try {
  const host = await open();
  await host.goto(origin);
  await host.getByRole('button', { name: 'Create preview session' }).click();
  await waitVideo(host);
  console.log('PASS: host sees live 1280×720 video from the cloud browser');
  await host.waitForFunction(() => document.getElementById('game')!.textContent === 'NYT Connections', null, { timeout: 30_000 });
  assert.match(await host.locator('#progress').innerText(), /^\d+ \/ 11 done today$/);
  console.log('PASS: game name and progress come from the extension inside the cloud browser');

  const viewer = await open();
  await viewer.goto(await host.locator('#invite').inputValue());
  await waitVideo(viewer);
  await waitVideo(host);
  assert.equal(await viewer.locator('#host').isVisible(), false);
  await viewer.getByRole('button', { name: 'Enable sound' }).click();
  await viewer.waitForFunction(() => (document.querySelector('video') as any).webkitAudioDecodedByteCount > 0, null, { timeout: 20_000 });
  console.log('PASS: late viewer gets video and audio; host stream recovers');

  // Host input: click the page and scroll; the socket must stay open and frames keep flowing.
  const box = (await host.locator('video').boundingBox())!;
  await host.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.wheel(0, 400);
  await host.keyboard.press('ArrowDown');
  const before = await frames(host);
  await host.waitForTimeout(3000);
  assert.ok(await frames(host) > before + 20, 'stream keeps flowing after input');
  assert.doesNotMatch(await host.locator('#status').innerText(), /Only the host|Invalid/);
  console.log('PASS: host clicks, scrolls and types without being disconnected');

  await mkdir('output/playwright', { recursive: true });
  await viewer.screenshot({ path: 'output/playwright/cloud-viewer.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: no page errors. Screenshot: output/playwright/cloud-viewer.png');
} finally {
  await browser.close();
}
