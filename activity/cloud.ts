// A real Chromium with the ti-jeux extension, drawn on Xvfb and captured with ffmpeg.
// The extension's navbar, completion tracking and site fixes run unchanged inside it.
import { chromium, type BrowserContext, type Page } from 'playwright-core';

export const MIME = 'video/webm;codecs=vp8,vorbis';
export const WIDTH = 1280;
export const HEIGHT = 720;
export type Metadata = { game: string; completed: number; total: number };
export type Input =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'down' | 'up'; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { kind: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { kind: 'keydown' | 'keyup'; key: string };
export type Cloud = {
  /** Starts a fresh WebM stream (new header, so every player can start from it). Returns stop. */
  stream(onChunk: (chunk: Uint8Array) => void): () => void;
  input(event: Input): Promise<void>;
  status(): Promise<Metadata>;
};

// Globals of the extension's service worker (sites.js is importScripts'd there).
declare const SITES: { url: string; name: string }[];
declare function matchesSite(href: string, url: string): boolean;
declare const chrome: any;

// Main-frame navigation stays on the games' own sites (and their logins).
// ponytail: last two labels only, fine for today's sites; wrong for co.uk/github.io-style hosts.
// Checked after commit, so an off-site page flashes before going home; context.route if that matters.
const domainOf = (host: string) => host.split('.').slice(-2).join('.');

export function createCloud(extension: string, profile: string): Cloud {
  let context: BrowserContext;
  let page: Page;
  let sites: { url: string; name: string }[] = [];
  let last: Metadata = { game: 'Starting the games…', completed: 0, total: 0 };
  let booting: Promise<void> | undefined;
  let respawning = false;
  const allowed = (href: string) => {
    if (href === 'about:blank') return true;
    try {
      const url = new URL(href);
      return url.protocol === 'https:' && sites.some((site) => domainOf(new URL(site.url).hostname) === domainOf(url.hostname));
    } catch { return false; }
  };
  const home = () => page.goto(sites[0]!.url).catch(() => {});
  const watch = (tab: Page) => {
    page = tab;
    tab.on('framenavigated', (frame) => { if (frame === tab.mainFrame() && !allowed(frame.url())) void home(); });
    tab.on('close', () => {
      if (page !== tab) return;
      respawning = true; // the popup closer must not close the replacement
      void context.newPage().then((next) => { watch(next); return home(); }).catch(() => {}).finally(() => { respawning = false; });
    });
  };
  // Other extensions (uBlock Origin Lite) have workers too; ours runs scripts/background.js.
  const ours = (w: { url(): string }) => w.url().endsWith('/scripts/background.js');
  const worker = async () => context.serviceWorkers().find(ours) || context.waitForEvent('serviceworker', { predicate: ours, timeout: 5000 });
  const boot = () => booting ??= (async () => {
    context = await chromium.launchPersistentContext(profile, {
      headless: false, viewport: null, acceptDownloads: false, executablePath: process.env.CHROMIUM_PATH || undefined,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--kiosk', `--window-size=${WIDTH},${HEIGHT}`, '--window-position=0,0',
        '--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled', '--no-first-run', '--disable-dev-shm-usage'],
    });
    context.on('close', () => { booting = undefined; });
    sites = await (await worker()).evaluate(() => SITES.map((s) => ({ url: s.url, name: s.name })));
    // One tab only: popups (share dialogs, ads) are closed.
    context.on('page', (tab) => { if (tab !== page && !respawning) void tab.close(); });
    watch(context.pages()[0] || await context.newPage());
    if (!allowed(page.url()) || page.url() === 'about:blank') await home();
  })().catch((error) => { booting = undefined; throw error; });

  return {
    stream(onChunk) {
      void boot().catch((error) => console.error('Cloud browser failed to start:', error));
      // Audio opens first: pulse takes ~2 s to start and would otherwise leave a hole in the video timeline.
      const ffmpeg = Bun.spawn(['ffmpeg', '-loglevel', 'error',
        '-thread_queue_size', '512', '-f', 'pulse', '-i', 'out.monitor',
        '-thread_queue_size', '512', '-f', 'x11grab', '-draw_mouse', '0', '-framerate', '15', '-video_size', `${WIDTH}x${HEIGHT}`, '-i', process.env.DISPLAY || ':99',
        '-map', '1:v', '-map', '0:a', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1500k', '-g', '30', '-auto-alt-ref', '0', '-lag-in-frames', '0',
        // Chromium's WebM parser rejects any block older than the one before it, across tracks:
        // strict interleaving, and Vorbis (the muxer shifts Opus blocks by its codec delay after interleaving).
        '-c:a', 'libvorbis', '-b:a', '96k', '-max_interleave_delta', '0', '-f', 'webm', '-cluster_time_limit', '500', 'pipe:1'], { stdout: 'pipe', stderr: 'inherit' });
      let stopped = false;
      // Bytes still buffered from a killed encoder must never reach a player of the next stream.
      void (async () => { for await (const chunk of ffmpeg.stdout) if (!stopped) onChunk(chunk); })().catch(() => {});
      return () => { stopped = true; ffmpeg.kill(); };
    },
    async input(event: Input) {
      await boot();
      switch (event.kind) {
        // Characters outside the US layout (é, ç…) are inserted as text.
        case 'keydown': { const { key } = event; await page.keyboard.down(key).catch(() => key.length === 1 ? page.keyboard.insertText(key) : undefined); return; }
        case 'keyup': await page.keyboard.up(event.key).catch(() => {}); return;
        case 'move': await page.mouse.move(event.x * WIDTH, event.y * HEIGHT); return;
        case 'wheel': await page.mouse.move(event.x * WIDTH, event.y * HEIGHT); await page.mouse.wheel(event.dx, event.dy); return;
        default: await page.mouse.move(event.x * WIDTH, event.y * HEIGHT); await page.mouse[event.kind]({ button: event.button });
      }
    },
    async status() {
      try {
        await boot();
        last = await (await worker()).evaluate(async (href) => {
          const site = SITES.find((s) => matchesSite(href, s.url));
          const { states = {}, completions = {} } = await chrome.storage.sync.get(['states', 'completions']);
          const active = SITES.filter((s) => states[s.url] !== false);
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
          return { game: site?.name || 'Browsing', completed: active.filter((s: any) => completions[s.url] === today).length, total: active.length };
        }, page.url());
      } catch { /* service worker asleep or browser restarting: keep the last known status */ }
      return last;
    },
  };
}
