import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { startServer, type Config } from './server';
import type { Cloud, Input } from './cloud';

test('signed launch, membership, host-only control, one cloud browser shared across Activities', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const config: Config = { port: 0, hostname: '127.0.0.1', publicOrigin: 'https://activity.example', clientId: '123456789012345678', clientSecret: 'test-secret', botToken: 'test-bot', publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), preview: false };
  let callbacks = 0;
  const discord = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/applications/@me')) return Response.json({ owner: { id: 'driver' } });
    if (url.includes('/callback?with_response=true')) {
      callbacks++;
      assert.deepEqual(JSON.parse(String(init?.body)), { type: 12 });
      return Response.json({ resource: { activity_instance: { id: url.includes('/second/') ? 'room-b' : 'room-a' } } });
    }
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: new URLSearchParams(String(init?.body)).get('code') });
    if (url.endsWith('/users/@me')) return Response.json({ id: new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') });
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bot test-bot');
    const id = url.split('/').at(-1);
    return Response.json({ application_id: config.clientId, instance_id: id, users: ['driver', 'viewer', 'friend'] });
  }) as typeof fetch;
  // Fake browser: each stream() is one encoder run; chunks are pushed by the test.
  const inputs: Input[] = [];
  let streams = 0;
  let emit = (_: Uint8Array) => {};
  const cloud: Cloud = {
    stream(onChunk) { streams++; emit = onChunk; return () => { emit = () => {}; }; },
    async input(event) { inputs.push(event); },
    async status() { return { game: 'NYT Mini', completed: 2, total: 11 }; },
  };
  const app = startServer(config, cloud, discord);
  const base = `http://127.0.0.1:${app.server.port}`;
  // Consume HTTP bodies so Bun can close its in-process client connections.
  const request = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const bytes = await response.arrayBuffer();
    return new Response(response.status === 202 ? null : bytes, { status: response.status, headers: response.headers });
  };
  const peers: WebSocket[] = [];
  const post = (path: string, data: unknown) => request(base + path, { method: 'POST', headers: { Origin: config.publicOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
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
      const deadline = Date.now() + 4000;
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
    assert.equal((await post('/api/session', { code: 'intruder', instanceId: 'room-a' })).status, 403);

    // A viewer arrives first: the games start, but they get no control.
    const viewer = await login('viewer');
    assert.equal(viewer.isHost, false);
    const watcher = await peer(viewer.token);
    await watcher.next((m) => m.type === 'ready');
    await watcher.next((m) => m.type === 'start');
    assert.equal(streams, 1);
    emit(new Uint8Array([1, 2, 3]));
    assert.deepEqual(new Uint8Array(await watcher.next((m) => m instanceof ArrayBuffer)), new Uint8Array([1, 2, 3]));

    // The launcher joins: the encoder restarts so the late player gets a header.
    const host = await login('driver');
    assert.equal(host.isHost, true);
    const driver = await peer(host.token);
    await driver.next((m) => m.type === 'start');
    await watcher.next((m) => m.type === 'start');
    assert.equal(streams, 2, 'the join restarts the encoder (after the 2 s debounce)');
    driver.send({ type: 'input', kind: 'down', button: 'left', x: 0.5, y: 0.25 });
    driver.send({ type: 'input', kind: 'keydown', key: 'é' });
    await Bun.sleep(50);
    assert.deepEqual(inputs, [{ kind: 'down', button: 'left', x: 0.5, y: 0.25 }, { kind: 'keydown', key: 'é' }]);
    assert.equal((await watcher.next((m) => m.type === 'status' && m.game === 'NYT Mini')).completed, 2);

    const badInput = await peer((await login('driver')).token);
    await badInput.next((m) => m.type === 'ready');
    badInput.send({ type: 'input', kind: 'move', x: 2, y: 0 });
    assert.match((await badInput.closed).reason, /Invalid input/);
    watcher.send({ type: 'input', kind: 'down', button: 'left', x: 0.1, y: 0.1 });
    assert.match((await watcher.closed).reason, /Only the host/);
    assert.equal(inputs.length, 2);

    // A second launch in the same instance cannot steal ownership.
    assert.equal((await launch('join', 'viewer')).status, 202);
    assert.equal((await login('viewer')).isHost, false);

    // Someone who isn't the app owner launches their own Activity: no room, no browser.
    await Bun.sleep(2100);
    const before = streams;
    assert.equal((await launch('second', 'friend')).status, 202);
    const refused = await post('/api/session', { code: 'friend', instanceId: 'room-b' });
    assert.equal(refused.status, 409);
    assert.match((await refused.json() as { error: string }).error, /owner/);
    await Bun.sleep(2100);
    assert.equal(streams, before, 'a non-host launch must not start the encoder');
    // Reusing a session token closes the older socket.
    const again = await peer(host.token);
    await again.next((m) => m.type === 'ready');
    assert.match((await driver.closed).reason, /another window/);

    // Leaving stops the encoder.
    for (const ws of peers) ws.close();
    await Bun.sleep(50);
    emit(new Uint8Array([7]));
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
