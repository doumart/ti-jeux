import { createPublicKey, randomBytes, verify } from 'node:crypto';
import type { ServerWebSocket } from 'bun';

const HOUR = 3_600_000;
const MAX_BUFFER = 4 * 1024 * 1024;
const token = () => randomBytes(32).toString('base64url');
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const text = (value: unknown, max = 256): string => {
  if (typeof value !== 'string' || !value.length || value.length > max) fail(400, 'Invalid request.');
  return value as string;
};

type Metadata = { game: string; completed: number; total: number };
type Room = {
  id: string; owner: string; hostName: string; created: number; touched: number;
  publisher?: Socket; viewers: Set<Socket>; metadata: Metadata; streaming: boolean;
};
type Session = { room: Room; user: string; role: 'viewer' | 'publisher'; expires: number };
type Socket = ServerWebSocket<{ session?: Session; timer?: ReturnType<typeof setTimeout>; window: number; bytes: number; messages: number }>;
export type Config = { port: number; hostname: string; publicOrigin: string; clientId: string; clientSecret: string; botToken: string; publicKey: string; preview: boolean };

export function startServer(config: Config, discordFetch: typeof fetch = fetch) {
  if (config.preview && config.hostname !== '127.0.0.1') throw new Error('Local preview must bind to 127.0.0.1.');
  if (!config.preview) {
    const bad = Object.entries({
      DISCORD_CLIENT_ID: !!config.clientId, DISCORD_CLIENT_SECRET: !!config.clientSecret, DISCORD_BOT_TOKEN: !!config.botToken,
      'DISCORD_PUBLIC_KEY (64 hex chars)': /^[a-f0-9]{64}$/i.test(config.publicKey), 'PUBLIC_ORIGIN (https://…)': config.publicOrigin.startsWith('https://'),
    }).filter(([, ok]) => !ok).map(([name]) => name);
    if (bad.length) throw new Error(`Missing or invalid: ${bad.join(', ')}. Or use LOCAL_PREVIEW=1.`);
  }
  // ponytail: one relay process, at most 100 rooms. Use shared room storage and a
  // media relay service if this grows beyond a small friends-and-family server.
  const rooms = new Map<string, Room>();
  const sockets = new Set<Socket>();
  const sessions = new Map<string, Session>();
  const interactionIds = new Map<string, number>();
  const allowedOrigins = new Set([config.publicOrigin, `https://${config.clientId}.discordsays.com`]);
  const key = config.publicKey ? createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(config.publicKey, 'hex')]), format: 'der', type: 'spki' }) : null;
  const makeRoom = (id: string, owner: string, hostName: string) => {
    if (rooms.size >= 100) fail(503, 'The server is full. Try again later.');
    const room: Room = { id, owner, hostName, created: Date.now(), touched: Date.now(), viewers: new Set(), metadata: { game: 'Waiting for the host', completed: 0, total: 0 }, streaming: false };
    rooms.set(id, room);
    return room;
  };
  const grant = (room: Room, user: string, role: Session['role']) => {
    if (sessions.size >= 5000) fail(503, 'The server is full.');
    const secret = token();
    sessions.set(secret, { room, user, role, expires: Date.now() + 4 * HOUR });
    return secret;
  };
  const sessionFor = (secret: string) => {
    const session = sessions.get(secret);
    if (!session || session.expires < Date.now() || rooms.get(session.room.id) !== session.room) fail(401, 'Session expired. Reopen the Activity.');
    return session!;
  };
  const send = (ws: Socket, message: unknown) => ws.send(JSON.stringify(message));
  const broadcast = (room: Room, message: unknown) => { for (const ws of room.viewers) send(ws, message); };
  const status = (room: Room) => ({ type: 'status', hostName: room.hostName, streaming: room.streaming, viewers: room.viewers.size, ...room.metadata });
  const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await discordFetch(`https://discord.com/api/v10${path}`, { ...init, signal: AbortSignal.timeout(8000) });
    if (!response.ok) fail(response.status === 429 ? 429 : 502, 'Discord could not verify this session. Try again.');
    return response.json() as Promise<T>;
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
          if (!room) fail(409, 'Launch a new Activity from the app launcher. The server has no host for this instance.');
          room!.touched = Date.now();
          return json({ accessToken, token: grant(room!, identity.id, 'viewer'), isHost: room!.owner === identity.id });
        }
        if (path === '/api/preview' && req.method === 'POST') {
          if (!config.preview || !originAllowed(req)) fail(403, 'Local preview is disabled.');
          const input = await body(req);
          const room = input.room ? rooms.get(text(input.room)) : makeRoom(`preview-${token()}`, token(), 'Preview host');
          if (!room) fail(404, 'Preview session ended. Create a new one.');
          return json({ room: room!.id, token: grant(room!, input.room ? token() : room!.owner, 'viewer'), isHost: !input.room });
        }
        if (path === '/api/pair' && req.method === 'POST') {
          if (!originAllowed(req)) fail(403, 'Invalid origin.');
          const session = sessionFor((req.headers.get('authorization') || '').replace(/^Bearer /, ''));
          if (session.role !== 'viewer' || session.user !== session.room.owner) fail(403, 'Only the Activity launcher can share a game.');
          session.room.publisher?.close(4000, 'Host issued a new pairing link.');
          for (const [secret, old] of sessions) if (old.room === session.room && old.role === 'publisher') sessions.delete(secret);
          const origin = config.preview ? url.origin : config.publicOrigin;
          return json({ link: `${origin}/#publish=${grant(session.room, session.user, 'publisher')}` });
        }
        if (path === '/ws' && req.method === 'GET') {
          const origin = req.headers.get('origin') || '';
          if (!originAllowed(req) && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) fail(403, 'Invalid origin.');
          if (server.upgrade(req, { data: { window: Date.now(), bytes: 0, messages: 0 } })) return;
          fail(400, 'WebSocket upgrade required.');
        }
        if (req.method !== 'GET') return json({ error: 'Not found.' }, 404);
        const files: Record<string, string> = { '/': '../activity/index.html', '/client.js': '../dist/activity/client.js', '/style.css': '../activity/style.css' };
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
      maxPayloadLength: MAX_BUFFER, backpressureLimit: MAX_BUFFER, closeOnBackpressureLimit: true, idleTimeout: 60,
      open(ws) { sockets.add(ws); ws.data.timer = setTimeout(() => ws.close(4001, 'Authentication required.'), 5000); },
      message(ws, data) {
        try {
          if (Date.now() - ws.data.window > 1000) { ws.data.window = Date.now(); ws.data.bytes = 0; ws.data.messages = 0; }
          ws.data.bytes += typeof data === 'string' ? data.length : data.byteLength;
          if (++ws.data.messages > 80 || ws.data.bytes > MAX_BUFFER) fail(429, 'Stream rate exceeded.');
          if (!ws.data.session) {
            if (typeof data !== 'string' || data.length > 2048) fail(401, 'Authentication required.');
            const message = JSON.parse(data as string);
            if (message.type !== 'auth') fail(401, 'Authentication required.');
            const session = sessionFor(text(message.token));
            const room = session.room;
            if (session.role === 'publisher' && room.publisher) fail(409, 'The host is already sharing. Stop that stream first.');
            if (session.role === 'viewer' && room.viewers.size >= 25) fail(429, 'This session has reached 25 viewers.');
            clearTimeout(ws.data.timer);
            ws.data.session = session;
            if (session.role === 'publisher') room.publisher = ws;
            else room.viewers.add(ws);
            send(ws, { type: 'ready', role: session.role });
            send(ws, status(room));
            if (session.role === 'viewer') room.publisher && send(room.publisher, { type: 'restart' });
            broadcast(room, status(room));
            return;
          }
          const session = ws.data.session;
          if (session.expires < Date.now()) fail(401, 'Session expired. Reopen the Activity.');
          const room = session.room;
          room.touched = Date.now();
          if (typeof data === 'string' && data === '{"type":"ping"}') { send(ws, { type: 'pong' }); return; }
          if (session.role !== 'publisher' || room.publisher !== ws) fail(403, 'Viewers cannot control the stream.');
          if (typeof data !== 'string') {
            if (!room.streaming) fail(400, 'Start the stream before sending media.');
            for (const viewer of room.viewers) viewer.send(data);
            return;
          }
          if (data.length > 2048) fail(400, 'Message too large.');
          const message = JSON.parse(data);
          if (message.type === 'start') {
            if (message.mime !== 'video/webm;codecs=vp8,opus') fail(400, 'Unsupported stream format.');
            room.streaming = true;
            broadcast(room, { type: 'start', mime: message.mime });
          } else if (message.type === 'metadata') {
            if (typeof message.game !== 'string' || message.game.length > 100 || !Number.isInteger(message.completed) || !Number.isInteger(message.total) || message.completed < 0 || message.total < message.completed || message.total > 100) fail(400, 'Invalid game progress.');
            room.metadata = { game: message.game, completed: message.completed, total: message.total };
          } else fail(400, 'Unknown message.');
          broadcast(room, status(room));
        } catch (error) { ws.close(4003, (error as Error).message.slice(0, 120)); }
      },
      close(ws) {
        sockets.delete(ws);
        clearTimeout(ws.data.timer);
        const room = ws.data.session?.room;
        if (!room) return;
        room.viewers.delete(ws);
        if (room.publisher === ws) { room.publisher = undefined; room.streaming = false; broadcast(room, { type: 'stop' }); }
        room.touched = Date.now();
        broadcast(room, status(room));
      },
    },
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, room] of rooms) if (now - room.created > 8 * HOUR || (!room.publisher && !room.viewers.size && now - room.touched > HOUR)) {
      room.publisher?.close(4001, 'Session ended.');
      for (const viewer of room.viewers) viewer.close(4001, 'Session ended.');
      rooms.delete(id);
    }
    for (const [secret, session] of sessions) if (session.expires < now || !rooms.has(session.room.id)) sessions.delete(secret);
    for (const [id, time] of interactionIds) if (now - time > 300_000) interactionIds.delete(id);
  }, 30_000);
  cleanup.unref();
  return { server, stop() { clearInterval(cleanup); for (const ws of sockets) ws.terminate(); return server.stop(true); } };
}

if (import.meta.main) {
  const preview = process.env.LOCAL_PREVIEW === '1';
  const port = Number(process.env.PORT || 3000);
  const env = (name: string) => (process.env[name] || '').trim();
  // Origins are compared exactly, so drop any pasted path or trailing slash.
  const publicOrigin = URL.canParse(env('PUBLIC_ORIGIN')) ? new URL(env('PUBLIC_ORIGIN')).origin : `http://localhost:${port}`;
  const { server } = startServer({ port, hostname: preview ? '127.0.0.1' : (env('HOST') || '0.0.0.0'), publicOrigin, clientId: env('DISCORD_CLIENT_ID'), clientSecret: env('DISCORD_CLIENT_SECRET'), botToken: env('DISCORD_BOT_TOKEN'), publicKey: env('DISCORD_PUBLIC_KEY'), preview });
  console.log(`ti-jeux Activity: ${server.url}${preview ? ' (local preview only)' : ''}`);
}
