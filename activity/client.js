import { DiscordSDK } from '@discord/embedded-app-sdk';

const $ = (id) => document.getElementById(id);
const video = $('video');
const theme = $('theme');
const embedded = new URLSearchParams(location.search).has('frame_id');
const prefix = embedded ? '/.proxy' : '';
let session;
let started = false;
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
  $('start').disabled = true;
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
    $('splash').hidden = false;
  };
  const pump = () => {
    if (disposed || !buffer || buffer.updating || source.readyState !== 'open') return;
    try {
      if (buffer.buffered.length) {
        const end = buffer.buffered.end(buffer.buffered.length - 1);
        // ffmpeg's live timestamps don't start at 0; jump to where the data begins.
        if (video.currentTime < buffer.buffered.start(0)) video.currentTime = buffer.buffered.start(0);
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
  $('start').disabled = false;
  report(session.isHost ? 'Ready. You drive: click the game to play, type to answer.' : 'Ready. The host is playing.');
  if (started) $('splash').hidden = true;
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
      report('Starting the games…');
    } else if (message.type === 'start') startPlayer(message.mime);
    else if (message.type === 'stop') { stopPlayer(); report('The games stopped.'); $('splash').hidden = false; }
    else if (message.type === 'status') {
      $('game').textContent = message.game;
      $('progress').textContent = message.total ? `${message.completed} / ${message.total} done today` : '';
      if (message.note) report(message.note);
    }
  };
  ws.onerror = () => report('Cannot reach the sharing server.');
  ws.onclose = (event) => {
    clearInterval(heartbeat);
    stopPlayer();
    report(event.reason || 'Disconnected. Reconnect to resume watching.');
    $('reconnect').hidden = false;
    $('splash').hidden = false;
  };
}

function joined(result) {
  session = result;
  $('stage').classList.toggle('driving', result.isHost);
  connect();
}

// Host input: positions are sent as 0–1 of the picture (letterboxing excluded).
const sendInput = (event) => { if (session?.isHost && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', ...event })); };
function point(event) {
  const box = video.getBoundingClientRect();
  const scale = Math.min(box.width / (video.videoWidth || 16), box.height / (video.videoHeight || 9));
  const width = (video.videoWidth || 16) * scale;
  const height = (video.videoHeight || 9) * scale;
  const x = (event.clientX - box.left - (box.width - width) / 2) / width;
  const y = (event.clientY - box.top - (box.height - height) / 2) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
const buttons = ['left', 'middle', 'right'];
let lastMove = 0;
let wheel = null;
video.addEventListener('pointerdown', (event) => {
  const at = point(event);
  if (!at || !buttons[event.button]) return;
  $('stage').focus();
  video.setPointerCapture(event.pointerId);
  sendInput({ kind: 'down', button: buttons[event.button], ...at });
});
video.addEventListener('pointerup', (event) => {
  const at = point(event);
  if (at && buttons[event.button]) sendInput({ kind: 'up', button: buttons[event.button], ...at });
});
video.addEventListener('pointermove', (event) => {
  const at = point(event);
  if (!at || Date.now() - lastMove < 50) return;
  lastMove = Date.now();
  sendInput({ kind: 'move', ...at });
});
video.addEventListener('wheel', (event) => {
  const at = point(event);
  if (!at || !session?.isHost) return;
  event.preventDefault();
  if (wheel) { wheel.dx += event.deltaX; wheel.dy += event.deltaY; return; }
  wheel = { kind: 'wheel', ...at, dx: event.deltaX, dy: event.deltaY };
  setTimeout(() => { const clamp = (v) => Math.max(-5000, Math.min(5000, v)); sendInput({ ...wheel, dx: clamp(wheel.dx), dy: clamp(wheel.dy) }); wheel = null; }, 50);
}, { passive: false });
video.addEventListener('contextmenu', (event) => { if (session?.isHost) event.preventDefault(); });
for (const type of ['keydown', 'keyup']) {
  $('stage').addEventListener(type, (event) => {
    if (!session?.isHost || event.key.length > 24 || ['Unidentified', 'Dead', 'Process'].includes(event.key)) return;
    event.preventDefault();
    sendInput({ kind: type, key: event.key });
  });
}
// Start-screen playlist in random order, never the same song twice in a row.
const songs = ['theme.mp3', 'bozo.mp3', 'wordle.mp3'];
let song = Math.floor(Math.random() * songs.length);
theme.src = `/.proxy/${songs[song]}`;
theme.onended = () => {
  song = (song + 1 + Math.floor(Math.random() * (songs.length - 1))) % songs.length;
  theme.src = `/.proxy/${songs[song]}`;
  theme.play().catch(() => {});
};
// Autoplay can be blocked until the first click; the music then starts on that click.
theme.play().catch(() => addEventListener('pointerdown', () => { if (!started) theme.play().catch(() => {}); }, { once: true }));
$('start').onclick = () => {
  started = true;
  $('splash').hidden = true;
  $('stage').focus();
  video.muted = false;
  video.play().catch(() => {});
  const fade = setInterval(() => {
    theme.volume = Math.max(0, theme.volume - 0.1);
    if (theme.volume === 0) { clearInterval(fade); theme.pause(); }
  }, 80);
};
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
