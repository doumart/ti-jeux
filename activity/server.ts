import { createPublicKey, randomBytes, verify } from 'node:crypto';
import type { ServerWebSocket } from 'bun';
import { MIME, type Cloud, type Input, type Metadata } from './cloud';

const HOUR = 3_600_000;
const token = () => randomBytes(32).toString('base64url');
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const text = (value: unknown, max = 256): string => {
  if (typeof value !== 'string' || !value.length || value.length > max) fail(400, 'Invalid request.');
  return value as string;
};
const unit = (value: unknown) => typeof value === 'number' && value >= 0 && value <= 1 ? value : fail(400, 'Invalid input.');
const delta = (value: unknown) => typeof value === 'number' && Math.abs(value) <= 5000 ? value : fail(400, 'Invalid input.');

// Only the host sends these; anything else closes the socket.
function parseInput(message: Record<string, unknown>): Input {
  const { kind } = message;
  if (kind === 'keydown' || kind === 'keyup') return { kind, key: text(message.key, 24) };
  const at = { x: unit(message.x), y: unit(message.y) };
  if (kind === 'move') return { kind, ...at };
  if (kind === 'wheel') return { kind, ...at, dx: delta(message.dx), dy: delta(message.dy) };
  if ((kind === 'down' || kind === 'up') && (message.button === 'left' || message.button === 'right' || message.button === 'middle')) return { kind, ...at, button: message.button };
  return fail(400, 'Invalid input.');
}

type Room = {
  id: string; owner: string; hostName: string; created: number; touched: number;
  drivable: boolean; viewers: Set<Socket>; metadata: Metadata;
};
type Session = { room: Room; user: string; expires: number; socket?: Socket };
type Socket = ServerWebSocket<{ session?: Session; timer?: ReturnType<typeof setTimeout>; window: number; messages: number }>;
export type Config = { port: number; hostname: string; publicOrigin: string; clientId: string; clientSecret: string; botToken: string; publicKey: string; preview: boolean; hosts?: string[] };

export function startServer(config: Config, cloud: Cloud, discordFetch: typeof fetch = fetch) {
  if (config.preview && config.publicOrigin.startsWith('https://')) throw new Error('LOCAL_PREVIEW has no sign-in; never run it with a public PUBLIC_ORIGIN.');
  if (!config.preview) {
    const bad = Object.entries({
      DISCORD_CLIENT_ID: !!config.clientId, DISCORD_CLIENT_SECRET: !!config.clientSecret, DISCORD_BOT_TOKEN: !!config.botToken,
      'DISCORD_PUBLIC_KEY (64 hex chars)': /^[a-f0-9]{64}$/i.test(config.publicKey), 'PUBLIC_ORIGIN (https://…)': config.publicOrigin.startsWith('https://'),
    }).filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length) throw new Error(`Missing or invalid: ${bad.join(', ')}. Or use LOCAL_PREVIEW=1.`);
  }
  // ponytail: one cloud browser, driven by one Activity at a time. Other Activities
  // wait for it. Run a browser per room if several groups need to play at once.
  const rooms = new Map<string, Room>();
  const sockets = new Set<Socket>();
  const sessions = new Map<string, Session>();
  const interactionIds = new Map<string, number>();
  let live: { room: Room; stop: () => void } | undefined;
  const allowedOrigins = new Set([config.publicOrigin, `https://${config.clientId}.discordsays.com`]);
  const key = config.publicKey ? createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(config.publicKey, 'hex')]), format: 'der', type: 'spki' }) : null;
  const send = (ws: Socket, message: unknown) => ws.send(JSON.stringify(message));
  const broadcast = (room: Room, message: unknown) => { for (const ws of room.viewers) send(ws, message); };
  const status = (room: Room) => ({
    type: 'status', hostName: room.hostName, viewers: room.viewers.size, streaming: live?.room === room, ...room.metadata,
    note: !room.drivable ? 'Only the app’s owner can host ti-jeux.' : live && live.room !== room ? 'The games are in use in another Activity. Waiting…' : '',
  });
  const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await discordFetch(`https://discord.com/api/v10${path}`, { ...init, signal: AbortSignal.timeout(8000) });
    if (!response.ok) fail(response.status === 429 ? 429 : 502, 'Discord could not verify this session. Try again.');
    return response.json() as Promise<T>;
  };
  // The browser holds your game logins, so only the app's owner/team (plus HOSTS) may drive it.
  let hosts: Promise<Set<string>> | undefined;
  const canHost = async (user: string) => {
    type Member = { user: { id: string }; membership_state: number; role?: string };
    hosts ??= api<{ owner?: { id: string }; team?: { members: Member[] } }>('/applications/@me', { headers: { Authorization: `Bot ${config.botToken}` } })
      // Accepted (state 2), non-read-only team members only; invites don't count.
      .then((app) => new Set([...(config.hosts || []), ...(app.team ? app.team.members.filter((m) => m.membership_state === 2 && m.role !== 'read_only').map((m) => m.user.id) : [app.owner?.id || ''])]))
      .catch((error) => { hosts = undefined; throw error; });
    return (await hosts).has(user);
  };
  const makeRoom = (id: string, owner: string, hostName: string) => {
    if (rooms.size >= 100) fail(503, 'The server is full. Try again later.');
    const room: Room = { id, owner, hostName, created: Date.now(), touched: Date.now(), drivable: true, viewers: new Set(), metadata: { game: 'Starting the games…', completed: 0, total: 0 } };
    rooms.set(id, room);
    return room;
  };
  const grant = (room: Room, user: string) => {
    if (sessions.size >= 5000) fail(503, 'The server is full.');
    const secret = token();
    sessions.set(secret, { room, user, expires: Date.now() + 4 * HOUR });
    return secret;
  };
  const sessionFor = (secret: string) => {
    const session = sessions.get(secret);
    if (!session || session.expires < Date.now() || rooms.get(session.room.id) !== session.room) fail(401, 'Session expired. Reopen the Activity.');
    return session!;
  };
  // (Re)start the encoder for a room. Late joiners need a fresh WebM header, so
  // ponytail: a join rebuffers everyone for a moment. Cache the header + last keyframe if that bothers.
  let lastEncode = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  const encode = (room: Room) => {
    clearTimeout(restartTimer);
    lastEncode = Date.now();
    live?.stop();
    broadcast(room, { type: 'start', mime: MIME });
    live = { room, stop: cloud.stream((chunk) => { for (const ws of room.viewers) ws.send(chunk); }) };
  };
  // A join restarts the encoder at most every 2 s, so a reconnect loop can't thrash it.
  const join = (room: Room) => {
    if (!room.drivable || (live && live.room !== room && live.room.viewers.size)) return;
    const wait = lastEncode + 2000 - Date.now();
    if (live?.room !== room || wait <= 0) encode(room);
    else { clearTimeout(restartTimer); restartTimer = setTimeout(() => { if (live?.room === room) encode(room); }, wait); }
  };
  const release = () => {
    clearTimeout(restartTimer);
    if (!live) return;
    const { room } = live;
    live.stop();
    live = undefined;
    broadcast(room, { type: 'stop' });
    const next = [...rooms.values()].find((r) => r !== room && r.drivable && r.viewers.size);
    if (next) { encode(next); broadcast(next, status(next)); }
  };
  const body = async (req: Request) => {
    const value = await req.json().catch(() => fail(400, 'Invalid JSON.'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Invalid request.');
    return value as Record<string, unknown>;
  };
  const originAllowed = (req: Request) => {
    const origin = req.headers.get('origin');
    return !!origin && (allowedOrigins.has(origin) || (config.preview && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)));
  };
  const server = Bun.serve<Socket['data']>({
    port: config.port, hostname: config.hostname, maxRequestBodySize: 16 * 1024,
    async fetch(req, server) {
      try {
        const url = new URL(req.url);
        const path = url.pathname.replace(/^\/\.proxy(?=\/)/, '');
        if (path === '/health' && req.method === 'GET') return json({ ok: true });
        if (path === '/api/config' && req.method === 'GET') return json({ clientId: config.clientId, preview: config.preview });
        if (path === '/api/interactions' && req.method === 'POST') {
          const raw = await req.text();
          const timestamp = req.headers.get('x-signature-timestamp') || '';
          const signature = req.headers.get('x-signature-ed25519') || '';
          if (!key || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{128}$/i.test(signature) || !verify(null, Buffer.from(timestamp + raw), key, Buffer.from(signature, 'hex'))) return json({ error: 'Invalid signature.' }, 401);
          const event = JSON.parse(raw);
          if (event.type === 1) return json({ type: 1 });
          if (event.application_id !== config.clientId || event.type !== 2 || event.data?.type !== 4) return json({ error: 'Unsupported interaction.' }, 400);
          const id = text(event.id);
          if (interactionIds.has(id)) return new Response(null, { status: 202 });
          const user = event.member?.user || event.user;
          const owner = text(user?.id);
          const hostName = text(user?.global_name || user?.username, 80);
          interactionIds.set(id, Date.now());
          try {
            // Launches by anyone who can't host are ignored, so they can't fill the room cap.
            if (!await canHost(owner)) return new Response(null, { status: 202 });
            // Discord returns the real instance ID; never elect the first viewer.
            const result = await api<{ resource?: { activity_instance?: { id: string } } }>(`/interactions/${encodeURIComponent(id)}/${encodeURIComponent(text(event.token))}/callback?with_response=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 12 }) });
            const instanceId = text(result.resource?.activity_instance?.id);
            if (!rooms.has(instanceId)) makeRoom(instanceId, owner, hostName);
            return new Response(null, { status: 202 });
          } catch (error) { interactionIds.delete(id); throw error; }
        }
        if (path === '/api/session' && req.method === 'POST') {
          if (!originAllowed(req)) fail(403, 'Invalid origin.');
          const input = await body(req);
          const instanceId = text(input.instanceId);
          const credentials = await api<{ access_token: string }>('/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code: text(input.code, 2048) }) });
          const accessToken = text(credentials.access_token, 2048);
          const identity = await api<{ id: string }>('/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
          const instance = await api<{ application_id: string; instance_id: string; users: string[] }>(`/applications/${config.clientId}/activity-instances/${encodeURIComponent(instanceId)}`, { headers: { Authorization: `Bot ${config.botToken}` } });
          if (instance.application_id !== config.clientId || instance.instance_id !== instanceId || !Array.isArray(instance.users) || !instance.users.includes(identity.id)) fail(403, 'You are not a participant in this Activity.');
          const room = rooms.get(instanceId);
          if (!room) fail(409, 'This Activity has no host. Only the app’s owner can launch ti-jeux.');
          room!.touched = Date.now();
          return json({ accessToken, token: grant(room!, identity.id), isHost: room!.drivable && room!.owner === identity.id });
        }
        if (path === '/api/preview' && req.method === 'POST') {
          if (!config.preview || !originAllowed(req)) fail(403, 'Local preview is disabled.');
          const input = await body(req);
          const room = input.room ? rooms.get(text(input.room)) : makeRoom(`preview-${token()}`, token(), 'Preview host');
          if (!room) fail(404, 'Preview session ended. Create a new one.');
          return json({ room: room!.id, token: grant(room!, input.room ? token() : room!.owner), isHost: !input.room });
        }
        if (path === '/ws' && req.method === 'GET') {
          if (!originAllowed(req)) fail(403, 'Invalid origin.');
          if (server.upgrade(req, { data: { window: Date.now(), messages: 0 } })) return;
          fail(400, 'WebSocket upgrade required.');
        }
        if (req.method !== 'GET') return json({ error: 'Not found.' }, 404);
        const files: Record<string, string> = { '/': '../activity/index.html', '/client.js': '../dist/activity/client.js', '/style.css': '../activity/style.css', '/theme.mp3': '../activity/theme.mp3', '/bozo.mp3': '../activity/bozo.mp3', '/wordle.mp3': '../activity/wordle.mp3' };
        if (!files[path]) return json({ error: 'Not found.' }, 404);
        const file = Bun.file(new URL(files[path], import.meta.url));
        if (!await file.exists()) fail(503, 'Run bun run activity:build first.');
        return new Response(file, { headers: { 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'" } });
      } catch (error) {
        const e = error as Error & { status?: number };
        return json({ error: e.status ? e.message : 'Request failed.' }, e.status || 500);
      }
    },
    websocket: {
      maxPayloadLength: 4096, backpressureLimit: 4 * 1024 * 1024, closeOnBackpressureLimit: true, idleTimeout: 60,
      open(ws) { sockets.add(ws); ws.data.timer = setTimeout(() => ws.close(4001, 'Authentication required.'), 5000); },
      message(ws, data) {
        try {
          if (Date.now() - ws.data.window > 1000) { ws.data.window = Date.now(); ws.data.messages = 0; }
          if (++ws.data.messages > 80) fail(429, 'Too many messages.');
          if (typeof data !== 'string') fail(400, 'Unexpected binary message.');
          const message = JSON.parse(data as string);
          if (!ws.data.session) {
            if (message.type !== 'auth') fail(401, 'Authentication required.');
            const session = sessionFor(text(message.token));
            const room = session.room;
            if (room.viewers.size >= 25) fail(429, 'This session has reached 25 viewers.');
            clearTimeout(ws.data.timer);
            // One socket per session: a token can't be reused to fill the room.
            session.socket?.close(4000, 'Opened in another window.');
            session.socket = ws;
            ws.data.session = session;
            room.viewers.add(ws);
            send(ws, { type: 'ready' });
            join(room);
            broadcast(room, status(room));
            return;
          }
          const session = ws.data.session;
          if (session.expires < Date.now()) fail(401, 'Session expired. Reopen the Activity.');
          const room = session.room;
          room.touched = Date.now();
          if (message.type === 'ping') { send(ws, { type: 'pong' }); return; }
          if (message.type !== 'input') fail(400, 'Unknown message.');
          if (!room.drivable || session.user !== room.owner) fail(403, 'Only the host can play. Everyone else watches.');
          const event = parseInput(message);
          if (live?.room === room) cloud.input(event).catch(() => {});
        } catch (error) { ws.close(4003, (error as Error).message.slice(0, 120)); }
      },
      close(ws) {
        sockets.delete(ws);
        clearTimeout(ws.data.timer);
        const room = ws.data.session?.room;
        if (!room) return;
        room.viewers.delete(ws);
        room.touched = Date.now();
        if (live?.room === room && !room.viewers.size) release();
        broadcast(room, status(room));
      },
    },
  });
  // Game name and today's progress, read from the extension inside the cloud browser.
  const poll = setInterval(async () => {
    if (!live) return;
    const { room } = live;
    const metadata = await cloud.status().catch(() => room.metadata);
    if (JSON.stringify(metadata) === JSON.stringify(room.metadata)) return;
    room.metadata = metadata;
    broadcast(room, status(room));
  }, 2000);
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) if (now - room.created > 8 * HOUR || (!room.viewers.size && now - room.touched > HOUR)) {
      for (const viewer of room.viewers) viewer.close(4001, 'Session ended.');
      rooms.delete(id);
    }
    for (const [secret, session] of sessions) if (session.expires < now || !rooms.has(session.room.id)) sessions.delete(secret);
    for (const [id, time] of interactionIds) if (now - time > 300_000) interactionIds.delete(id);
  }, 30_000);
  poll.unref();
  cleanup.unref();
  return { server, stop() { clearInterval(poll); clearInterval(cleanup); live?.stop(); for (const ws of sockets) ws.terminate(); return server.stop(true); } };
}

if (import.meta.main) {
  const { createCloud } = await import('./cloud');
  const preview = process.env.LOCAL_PREVIEW === '1';
  const port = Number(process.env.PORT || 3000);
  const env = (name: string) => (process.env[name] || '').trim();
  // Origins are compared exactly, so drop any pasted path or trailing slash.
  const publicOrigin = URL.canParse(env('PUBLIC_ORIGIN')) ? new URL(env('PUBLIC_ORIGIN')).origin : `http://localhost:${port}`;
  const root = new URL('..', import.meta.url).pathname;
  // UBOL_DIR: uBlock Origin Lite, loaded next to ti-jeux (the Docker image sets it).
  const cloud = createCloud([root, env('UBOL_DIR')].filter(Boolean).join(','), env('PROFILE_DIR') || `${root}.profile`);
  // Preview has no sign-in, so it listens on loopback unless PREVIEW_HOST says otherwise (Docker dev).
  const hostname = preview ? (env('PREVIEW_HOST') || '127.0.0.1') : (env('HOST') || '0.0.0.0');
  const { server } = startServer({ port, hostname, publicOrigin, clientId: env('DISCORD_CLIENT_ID'), clientSecret: env('DISCORD_CLIENT_SECRET'), botToken: env('DISCORD_BOT_TOKEN'), publicKey: env('DISCORD_PUBLIC_KEY'), preview, hosts: env('HOSTS').split(',').filter(Boolean) }, cloud);
  console.log(`ti-jeux Activity: ${server.url}${preview ? ' (local preview, no sign-in)' : ''}`);
}
