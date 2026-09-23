import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { startServer, type Config } from './server';

test('signed Discord launch, membership, host authority, relay isolation and lifecycle', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const config: Config = { port: 0, hostname: '127.0.0.1', publicOrigin: 'https://activity.example', clientId: '123456789012345678', clientSecret: 'test-secret', botToken: 'test-bot', publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), preview: false };
  let callbacks = 0;
  const discord = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/callback?with_response=true')) {
      callbacks++;
      assert.deepEqual(JSON.parse(String(init?.body)), { type: 12 });
      return Response.json({ resource: { activity_instance: { id: url.includes('/second/') ? 'room-b' : 'room-a' } } });
    }
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: new URLSearchParams(String(init?.body)).get('code') });
    if (url.endsWith('/users/@me')) return Response.json({ id: new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bot test-bot');
    const id = url.split('/').at(-1);
    return Response.json({ application_id: config.clientId, instance_id: id, users: ['driver', 'viewer'] });
  }) as typeof fetch;
  const app = startServer(config, discord);
  const base = `http://127.0.0.1:${app.server.port}`;
  // Consume HTTP bodies so Bun can close its in-process client connections.
  const request = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const bytes = await response.arrayBuffer();
    return new Response(response.status === 202 ? null : bytes, { status: response.status, headers: response.headers });
  };
  const peers: WebSocket[] = [];
  const post = (path: string, data: unknown, token?: string) => request(base + path, { method: 'POST', headers: { Origin: config.publicOrigin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
  const launch = async (id: string, owner = 'driver', signed = true, timestamp = String(Math.floor(Date.now() / 1000))) => {
    const raw = JSON.stringify({ type: 2, id, application_id: config.clientId, token: 'interaction-token', data: { type: 4 }, user: { id: owner, username: owner } });
    return request(base + '/api/interactions', { method: 'POST', headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': signed ? sign(null, Buffer.from(timestamp + raw), privateKey).toString('hex') : '0'.repeat(128) }, body: raw });
  };
  async function peer(token: string) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { Origin: config.publicOrigin } });
    peers.push(ws);
    ws.binaryType = 'arraybuffer';
    const closed = new Promise<CloseEvent>((resolve) => { ws.onclose = resolve; });
    const messages: any[] = [];
    ws.onmessage = ({ data }) => messages.push(typeof data === 'string' ? JSON.parse(data) : data);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = reject; });
    const next = async (predicate: (message: any) => boolean) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await Bun.sleep(10);
      }
      throw new Error(`Missing socket message; received ${JSON.stringify(messages)}`);
    };
    ws.send(JSON.stringify({ type: 'auth', token }));
    return { ws, messages, next, closed, send: (data: unknown) => ws.send(JSON.stringify(data)) };
  }
  const login = async (code: string, instanceId = 'room-a') => {
    const response = await post('/api/session', { code, instanceId, host: true, userId: 'driver' });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ token: string; isHost: boolean }>;
  };
  try {
    assert.equal((await launch('bad', 'driver', false)).status, 401);
    assert.equal((await launch('old', 'driver', true, '1')).status, 401);
    assert.equal((await post('/api/preview', {})).status, 403);
    assert.equal((await launch('first')).status, 202);
    assert.equal((await launch('first')).status, 202);
    assert.equal(callbacks, 1, 'replayed signed launch must not launch twice');
    // Viewer authenticates before the launcher. That must never grant host rights.
    const viewer = await login('viewer');
    assert.equal(viewer.isHost, false);
    assert.equal((await post('/api/pair', {}, viewer.token)).status, 403);
    assert.equal((await post('/api/session', { code: 'intruder', instanceId: 'room-a' })).status, 403);
    const host = await login('driver');
    assert.equal(host.isHost, true);
    const pairing = await (await post('/api/pair', {}, host.token)).json() as { link: string };
    const secret = new URLSearchParams(new URL(pairing.link).hash.slice(1)).get('publish')!;
    assert.equal(secret.length, 43);
    const watcher = await peer(viewer.token);
    await watcher.next((m) => m.type === 'ready');
    const publisher = await peer(secret);
    await publisher.next((m) => m.type === 'ready');
    const duplicate = await peer(secret);
    assert.match((await duplicate.closed).reason, /already sharing/);
    publisher.send({ type: 'start', mime: 'video/webm;codecs=vp8,opus' });
    await watcher.next((m) => m.type === 'start');
    publisher.ws.send(new Uint8Array([1, 2, 3]));
    assert.deepEqual(new Uint8Array(await watcher.next((m) => m instanceof ArrayBuffer)), new Uint8Array([1, 2, 3]));
    publisher.send({ type: 'metadata', game: 'NYT Mini', completed: 2, total: 11 });
    assert.equal((await watcher.next((m) => m.type === 'status' && m.game === 'NYT Mini')).completed, 2);
    const late = await peer(viewer.token);
    await late.next((m) => m.type === 'ready');
    await publisher.next((m) => m.type === 'restart');
    publisher.send({ type: 'start', mime: 'video/webm;codecs=vp8,opus' });
    await late.next((m) => m.type === 'start');
    // Joining via a second launch in the same instance cannot steal ownership.
    assert.equal((await launch('join', 'viewer')).status, 202);
    assert.equal((await login('viewer')).isHost, false);
    late.send({ type: 'metadata', game: 'forged', completed: 11, total: 11 });
    assert.match((await late.closed).reason, /Viewers cannot/);
    await launch('second');
    const other = await peer((await login('viewer', 'room-b')).token);
    await other.next((m) => m.type === 'ready');
    publisher.ws.send(new Uint8Array([4, 5, 6]));
    await watcher.next((m) => m instanceof ArrayBuffer);
    assert.equal(other.messages.some((m) => m instanceof ArrayBuffer), false, 'rooms must not leak media');
    publisher.ws.close();
    await watcher.next((m) => m.type === 'stop');
    const resumed = await peer(secret);
    await resumed.next((m) => m.type === 'ready');
    await post('/api/pair', {}, host.token);
    assert.match((await resumed.closed).reason, /new pairing/);
    const stale = await peer(secret);
    assert.match((await stale.closed).reason, /expired/);
    assert.equal((await request(base + '/.env')).status, 404);
    assert.equal((await request(base + '/api/config')).status, 200);
    assert.equal((await request(base + '/.proxy/api/config')).status, 200);
  } finally {
    for (const ws of peers) ws.close();
    // Bun 1.3.5 closes the listener but never resolves stop() after ws.close().
    // https://github.com/oven-sh/bun/issues/36223
    void app.stop();
    await assert.rejects(fetch(base + '/health', { signal: AbortSignal.timeout(1000) }));
  }
}, 15_000);
