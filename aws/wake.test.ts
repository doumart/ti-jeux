// The wake Lambda, with a fake EC2 and a fake server.
import { afterEach, expect, mock, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
Object.assign(process.env, { INSTANCE_ID: 'i-test', DOMAIN: 'tijeux.example', DISCORD_PUBLIC_KEY: raw });

let state = 'stopped';
const sent: string[] = [];
mock.module('@aws-sdk/client-ec2', () => ({
  EC2Client: class { async send(command: { name: string }) { sent.push(command.name); return { Reservations: [{ Instances: [{ State: { Name: state } }] }] }; } },
  DescribeInstancesCommand: class { name = 'describe'; },
  StartInstancesCommand: class { name = 'start'; },
}));

const { handler } = require('./wake.js');

const call = (interaction: unknown, { age = 0, forge = false } = {}) => {
  const body = JSON.stringify(interaction);
  const timestamp = String(Math.floor(Date.now() / 1000) - age);
  const signature = sign(null, Buffer.from(timestamp + body + (forge ? 'x' : '')), privateKey).toString('hex');
  return handler({ body, isBase64Encoded: false, headers: { 'x-signature-timestamp': timestamp, 'x-signature-ed25519': signature } });
};
const launch = { type: 2, data: { type: 4 } };
const realFetch = globalThis.fetch;
afterEach(() => { sent.length = 0; globalThis.fetch = realFetch; });

test('rejects forged and replayed requests without touching EC2', async () => {
  expect((await call(launch, { forge: true })).statusCode).toBe(401);
  expect((await call(launch, { age: 400 })).statusCode).toBe(401);
  expect(sent).toEqual([]);
});

test('answers the endpoint check', async () => {
  expect(JSON.parse((await call({ type: 1 })).body)).toEqual({ type: 1 });
});

test('starts a stopped instance and tells the launcher to retry', async () => {
  state = 'stopped';
  const response = await call(launch);
  expect(sent).toEqual(['describe', 'start']);
  expect(JSON.parse(response.body).data.content).toContain('Waking up');
});

test('forwards to a running instance unchanged', async () => {
  state = 'running';
  let forwarded: Request | undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => { forwarded = new Request(url, init); return new Response(null, { status: 202 }); }) as typeof fetch;
  const response = await call(launch);
  expect(response.statusCode).toBe(202);
  expect(forwarded!.url).toBe('https://tijeux.example/api/interactions');
  expect(await forwarded!.text()).toBe(JSON.stringify(launch));
  expect(sent).toEqual(['describe']);
});

test('says the server is starting when it does not answer yet', async () => {
  state = 'running';
  globalThis.fetch = (async () => { throw new Error('refused'); }) as unknown as typeof fetch;
  expect(JSON.parse((await call(launch)).body).data.content).toContain('still starting');
});
