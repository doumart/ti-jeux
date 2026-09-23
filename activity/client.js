import { DiscordSDK } from '@discord/embedded-app-sdk';

const $ = (id) => document.getElementById(id);
const video = $('video');
const embedded = new URLSearchParams(location.search).has('frame_id');
const prefix = embedded ? '/.proxy' : '';
let session;
let socket;
let heartbeat;
let disposePlayer = () => {};
let receiveMedia = () => {};
const report = (message) => { $('status').textContent = message; };
async function request(path, body, secret) {
  const response = await fetch(`${prefix}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not connect.');
  return result;
}

function stopPlayer() {
  disposePlayer();
  disposePlayer = () => {};
  receiveMedia = () => {};
  video.removeAttribute('src');
  video.load();
  $('sound').disabled = true;
}

function startPlayer(mime) {
  stopPlayer();
  if (!window.MediaSource?.isTypeSupported(mime)) {
    report('This client cannot play the shared video. Join using desktop Discord or Chrome.');
    return;
  }
  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  let buffer;
  let queue = [];
  let queuedBytes = 0;
  let disposed = false;
  let playing = false;
  const broken = () => {
    if (disposed) return;
    stopPlayer();
    report('Playback interrupted. Reconnect to resume the live game.');
    $('reconnect').hidden = false;
  };
  const pump = () => {
    if (disposed || !buffer || buffer.updating || source.readyState !== 'open') return;
    try {
      if (buffer.buffered.length) {
        const end = buffer.buffered.end(buffer.buffered.length - 1);
        if (end - video.currentTime > 3) video.currentTime = Math.max(0, end - 0.8);
        if (!playing && end > 0.3) {
          playing = true;
          video.play().catch(() => { playing = false; report('Press play to watch the host’s game.'); });
        }
        if (video.currentTime - buffer.buffered.start(0) > 20) {
          buffer.remove(0, video.currentTime - 10);
          return;
        }
      }
      if (queue.length) {
        const chunk = queue.shift();
        queuedBytes -= chunk.byteLength;
        buffer.appendBuffer(chunk);
      }
    } catch { broken(); }
  };
  disposePlayer = () => {
    disposed = true;
    queue = [];
    URL.revokeObjectURL(url);
    video.removeEventListener('error', broken);
  };
  receiveMedia = (chunk) => {
    queuedBytes += chunk.byteLength;
    if (queuedBytes > 8 * 1024 * 1024) { broken(); return; }
    queue.push(chunk);
    pump();
  };
  source.addEventListener('sourceopen', () => {
    if (disposed) return;
    try {
      buffer = source.addSourceBuffer(mime);
      buffer.addEventListener('updateend', pump);
      buffer.addEventListener('error', broken);
      pump();
    } catch { broken(); }
  }, { once: true });
  video.addEventListener('error', broken);
  video.src = url;
  $('sound').disabled = false;
  report('Live · the host controls the game');
}

function connect() {
  if (!session) return;
  if (socket) { socket.onclose = null; socket.close(); }
  clearInterval(heartbeat);
  stopPlayer();
  $('reconnect').hidden = true;
  report('Connecting to the shared game…');
  const url = new URL(`${prefix}/ws`, location.origin);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = socket = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: session.token }));
  ws.onmessage = ({ data }) => {
    if (typeof data !== 'string') { receiveMedia(data); return; }
    const message = JSON.parse(data);
    if (message.type === 'ready') {
      heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}'); }, 20_000);
      report('Waiting for the host to share a game…');
    } else if (message.type === 'start') startPlayer(message.mime);
    else if (message.type === 'stop') { stopPlayer(); report('The host stopped sharing. Waiting for them to return…'); }
    else if (message.type === 'status') {
      $('game').textContent = message.game;
      $('progress').textContent = message.total ? `${message.completed} / ${message.total} done today` : '';
      $('audience').textContent = `${message.hostName} hosting · ${message.viewers} watching`;
    }
  };
  ws.onerror = () => report('Cannot reach the sharing server.');
  ws.onclose = (event) => {
    clearInterval(heartbeat);
    stopPlayer();
    report(event.reason || 'Disconnected. Reconnect to resume watching.');
    $('reconnect').hidden = false;
  };
}

function joined(result) {
  session = result;
  $('host').hidden = !result.isHost;
  connect();
}

$('pair').onclick = async () => {
  $('pair').disabled = true;
  try {
    const { link } = await request('/api/pair', {}, session.token);
    $('pair-link').value = link;
    $('pair-label').hidden = false;
    $('copy').hidden = false;
    $('pair').textContent = 'Replace sharing link';
  } catch (error) { report(error.message); }
  finally { $('pair').disabled = false; }
};
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('pair-link').value); report('Link copied. Paste it into the extension’s sharing page.'); }
  catch { $('pair-link').select(); report('Copy the selected link and paste it into the extension’s sharing page.'); }
};
$('sound').onclick = () => { video.muted = !video.muted; video.play().catch(() => {}); };
video.onvolumechange = () => { $('sound').textContent = video.muted ? 'Enable sound' : 'Mute sound'; };
$('reconnect').onclick = connect;
$('create').onclick = async () => {
  $('create').disabled = true;
  try {
    const result = await request('/api/preview', {});
    $('invite').value = `${location.origin}/#room=${result.room}`;
    $('invite-label').hidden = false;
    joined(result);
  } catch (error) { report(error.message); $('create').disabled = false; }
};
window.addEventListener('pagehide', () => { clearInterval(heartbeat); socket?.close(); stopPlayer(); });

async function init() {
  const config = await fetch(`${prefix}/api/config`).then((r) => r.json());
  if (embedded) {
    if (!config.clientId) throw new Error('The server needs a Discord application ID.');
    const sdk = new DiscordSDK(config.clientId);
    await sdk.ready();
    const { code } = await sdk.commands.authorize({ client_id: config.clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
    const result = await request('/api/session', { code, instanceId: sdk.instanceId });
    await sdk.commands.authenticate({ access_token: result.accessToken });
    joined(result);
  } else if (config.preview) {
    $('preview').hidden = false;
    const room = new URLSearchParams(location.hash.slice(1)).get('room');
    if (room) { $('create').hidden = true; joined(await request('/api/preview', { room })); }
    else report('Create a local session to test sharing.');
  } else report('Launch ti-jeux from Discord’s app launcher to start or join a session.');
}
init().catch((error) => report(error.message));
