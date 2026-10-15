// Discord's Interactions Endpoint. Starts the stopped instance, or forwards to it once it runs.
const { createPublicKey, verify } = require('node:crypto');
const { EC2Client, DescribeInstancesCommand, StartInstancesCommand } = require('@aws-sdk/client-ec2');
const ec2 = new EC2Client();
const { INSTANCE_ID, DOMAIN, DISCORD_PUBLIC_KEY } = process.env;
const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(DISCORD_PUBLIC_KEY, 'hex')]), format: 'der', type: 'spki' });
const reply = (body, statusCode = 200) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const say = (content) => reply({ type: 4, data: { content, flags: 64 } });

exports.handler = async (event) => {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '';
  const timestamp = event.headers['x-signature-timestamp'] || '';
  const signature = event.headers['x-signature-ed25519'] || '';
  // Only Discord may wake the instance. Old requests can't be replayed.
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^[a-f0-9]{128}$/i.test(signature)
    || !verify(null, Buffer.from(timestamp + raw), key, Buffer.from(signature, 'hex'))) return reply({ error: 'Invalid signature.' }, 401);
  if (JSON.parse(raw).type === 1) return reply({ type: 1 });
  const { Reservations } = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
  const state = Reservations[0].Instances[0].State.Name;
  if (state === 'stopped') {
    await ec2.send(new StartInstancesCommand({ InstanceIds: [INSTANCE_ID] }));
    return say('Waking up the server. Launch the Activity again in about a minute.');
  }
  if (state !== 'running') return say(`The server is ${state}. Launch the Activity again in a minute.`);
  try {
    // Discord waits 3 s for the reply.
    const response = await fetch(`https://${DOMAIN}/api/interactions`, {
      method: 'POST', body: raw, signal: AbortSignal.timeout(2000),
      headers: { 'Content-Type': 'application/json', 'X-Signature-Timestamp': timestamp, 'X-Signature-Ed25519': signature },
    });
    return { statusCode: response.status, headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' }, body: await response.text() };
  } catch {
    return say('The server is still starting. Launch the Activity again in a minute.');
  }
};
