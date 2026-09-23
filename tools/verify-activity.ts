// Real Chromium capture → MediaRecorder → Bun WebSocket → MediaSource playback.
// Requires Chrome for Testing (Playwright cache, or CHROMIUM_PATH).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { startServer } from '../activity/server';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
// Unpacked extension ID = first 32 hex chars of sha256(path), mapped 0-f → a-p.
// Allowlisting stands in for the toolbar click that grants tabCapture on a tab.
const extensionId = [...new Bun.CryptoHasher('sha256').update(root).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const profile = await mkdtemp(join(tmpdir(), 'tijeux-activity-'));
const app = startServer({ port: 0, hostname: '127.0.0.1', publicOrigin: 'http://localhost', clientId: '', clientSecret: '', botToken: '', publicKey: '', preview: true });
const origin = `http://127.0.0.1:${app.server.port}`;
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
  headless: true,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, `--allowlisted-extension-id=${extensionId}`, '--autoplay-policy=no-user-gesture-required'],
});
const errors: string[] = [];
context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
const fixture = (name: string) => `<!doctype html><title>${name}</title><style>body{background:#18384a;color:white;font:24px system-ui}canvas{width:640px;height:360px}</style><h1>${name}</h1><button id="tone">Play game audio</button><button id="complete">Complete puzzle</button><canvas width="640" height="360"></canvas><script>
const canvas=document.querySelector('canvas'), ctx=canvas.getContext('2d');let frame=0;
setInterval(()=>{ctx.fillStyle='#18384a';ctx.fillRect(0,0,640,360);ctx.fillStyle='#9ef7c1';ctx.fillRect((frame++*5)%560,100,80,80);ctx.font='30px sans-serif';ctx.fillText('ti-jeux · '+frame,30,50)},100);
document.querySelector('#tone').onclick=()=>{const a=new AudioContext(),o=a.createOscillator(),g=a.createGain();g.gain.value=.02;o.connect(g).connect(a.destination);o.start();};
document.querySelector('#complete').onclick=e=>{e.target.textContent='Share Results';};
</script>`;
const waitVideo = async (page: Page) => {
  await page.waitForFunction(() => {
    const v = document.querySelector('video')!;
    return v.videoWidth > 0 && v.currentTime > 0.5 && v.getVideoPlaybackQuality().totalVideoFrames > 2;
  }, null, { timeout: 20_000 });
};
try {
  await context.route('https://guessthe.game/**', (route) => route.fulfill({ contentType: 'text/html', body: fixture('Guess the Game') }));
  await context.route('https://guessthemovie.name/**', (route) => route.fulfill({ contentType: 'text/html', body: fixture('Guess the Movie') }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extension = new URL(worker.url()).host;
  const host = await context.newPage();
  await host.goto(origin);
  await host.getByRole('button', { name: 'Create preview session' }).click();
  await host.getByRole('button', { name: 'Get sharing link' }).click();
  await host.waitForFunction(() => (document.getElementById('pair-link') as HTMLInputElement).value);
  const link = await host.locator('#pair-link').inputValue();
  const viewerLink = await host.locator('#invite').inputValue();
  assert.match(link, /#publish=[\w-]{43}$/);

  const game = await context.newPage();
  await game.goto('https://guessthe.game/');
  await game.locator('#tone').click();
  const tabId = await worker.evaluate(async () => {
    const tabs = await (globalThis as any).chrome.tabs.query({});
    return tabs.find((tab: any) => tab.url === 'https://guessthe.game/').id as number;
  });
  const share = await context.newPage();
  await share.goto(`chrome-extension://${extension}/ui/share.html?tab=${tabId}`);
  await share.getByLabel('Private sharing link').fill(link);
  await share.getByRole('button', { name: 'Start sharing this game' }).click();
  await share.waitForFunction(() => !['Not sharing.', 'Starting tab capture…'].includes(document.getElementById('status')!.textContent!), null, { timeout: 15_000 });
  const sharingStatus = await share.locator('#status').innerText();
  assert.match(sharingStatus, /^Sharing video/, sharingStatus);
  await waitVideo(host);
  console.log('PASS: real extension tab capture and host video playback');

  const viewer = await context.newPage();
  await viewer.goto(viewerLink);
  await waitVideo(viewer);
  assert.equal(await viewer.locator('#host').isVisible(), false);
  await viewer.getByRole('button', { name: 'Enable sound' }).click();
  await viewer.waitForFunction(() => (document.querySelector('video') as any).webkitAudioDecodedByteCount > 0);
  assert.equal(await viewer.locator('video').evaluate((v: HTMLVideoElement) => v.muted), false);
  await waitVideo(host);
  console.log('PASS: late join resets cleanly; both viewers decode video and audio');

  await game.locator('#complete').click();
  await viewer.waitForFunction(() => document.getElementById('progress')!.textContent!.startsWith('1 /'));
  await game.goto('https://guessthemovie.name/');
  await viewer.waitForFunction(() => document.getElementById('game')!.textContent === 'Guess the Movie');
  await waitVideo(viewer);
  console.log('PASS: completion and cross-site navigation reach viewers while capture continues');

  await mkdir(join(root, 'output/playwright'), { recursive: true });
  await viewer.screenshot({ path: join(root, 'output/playwright/activity-viewer.png'), fullPage: true });
  await viewer.reload();
  await waitVideo(viewer);
  console.log('PASS: viewer reconnect receives a fresh playable stream');

  await share.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await viewer.waitForFunction(() => document.getElementById('status')!.textContent!.includes('stopped sharing'));
  assert.equal(await viewer.locator('video').getAttribute('src'), null);
  const captures = await worker.evaluate(async () => (globalThis as any).chrome.tabCapture.getCapturedTabs());
  assert.equal(captures.some((capture: any) => capture.status === 'active'), false);
  assert.deepEqual(errors, []);
  console.log('PASS: stop releases capture and clears every viewer; no browser errors');
} finally {
  await context.close();
  void app.stop(); // Bun 1.3.5 stop promise bug: oven-sh/bun#36223.
  await rm(profile, { recursive: true, force: true });
}
