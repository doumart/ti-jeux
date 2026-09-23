const tabId = Number(new URLSearchParams(location.search).get('tab'));
const mime = 'video/webm;codecs=vp8,opus';
const statusEl = document.getElementById('status');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
let socket;
let stream;
let recorder;
let audio;
let heartbeat;
let connectTimeout;
let restartTimer;
let starting = false;
let generation = 0;

function stop(message = 'Sharing stopped.') {
  generation++;
  starting = false;
  clearInterval(heartbeat);
  clearTimeout(connectTimeout);
  clearTimeout(restartTimer);
  if (recorder) {
    recorder.ondataavailable = null;
    recorder.onerror = null;
    if (recorder.state !== 'inactive') recorder.stop();
    recorder = null;
  }
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  audio?.close().catch(() => {});
  audio = null;
  if (socket) { socket.onclose = null; socket.close(); socket = null; }
  startButton.disabled = false;
  stopButton.disabled = true;
  document.getElementById('pairing').disabled = false;
  statusEl.textContent = message;
}

function record() {
  if (!stream || socket?.readyState !== WebSocket.OPEN) return;
  if (recorder) {
    recorder.ondataavailable = null;
    recorder.onerror = null;
    if (recorder.state !== 'inactive') recorder.stop();
  }
  // ponytail: a late join restarts the encoder for everyone (a brief rebuffer).
  // Add a WebM initialization/keyframe cache if uninterrupted joins matter.
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000, videoKeyFrameIntervalDuration: 1000 });
  recorder.ondataavailable = ({ data }) => {
    if (!data.size || socket?.readyState !== WebSocket.OPEN) return;
    if (data.size > 4 * 1024 * 1024 || socket.bufferedAmount > 4 * 1024 * 1024) { stop('Upload cannot keep up. Check your connection and start sharing again.'); return; }
    socket.send(data);
  };
  recorder.onerror = () => stop('Recording failed. Start sharing again.');
  socket.send(JSON.stringify({ type: 'start', mime }));
  recorder.start(250);
}

async function metadata() {
  try {
    const tab = await chrome.tabs.get(tabId);
    const site = SITES.find((s) => matchesSite(tab.url || '', s.url));
    document.getElementById('game').textContent = site?.name || 'Shared tab';
    const { states = {}, completions = {} } = await chrome.storage.sync.get(['states', 'completions']);
    const active = SITES.filter((s) => states[s.url] !== false);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    if (socket?.readyState === WebSocket.OPEN && recorder) socket.send(JSON.stringify({ type: 'metadata', game: site?.name || 'Shared tab', completed: active.filter((s) => completions[s.url] === today).length, total: active.length }));
  } catch { stop('The game tab was closed. Open a game and choose Share to Discord again.'); startButton.disabled = true; }
}

document.getElementById('sharing').onsubmit = async (event) => {
  event.preventDefault();
  if (starting || stream) return;
  const attempt = ++generation;
  try {
    const link = new URL(document.getElementById('pairing').value.trim());
    const secret = new URLSearchParams(link.hash.slice(1)).get('publish');
    if ((link.protocol !== 'https:' && !(link.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(link.hostname))) || link.username || link.password || !/^[\w-]{43}$/.test(secret || '')) throw new Error('Paste the private sharing link from your ti-jeux Activity.');
    if (!Number.isInteger(tabId) || tabId < 1) throw new Error('Open a game and choose Share to Discord from the extension popup.');
    if (!MediaRecorder.isTypeSupported(mime)) throw new Error('This Chrome version cannot encode the stream. Update Chrome and try again.');
    starting = true;
    startButton.disabled = true;
    stopButton.disabled = false;
    document.getElementById('pairing').disabled = true;
    statusEl.textContent = 'Starting tab capture…';
    audio = new AudioContext();
    await audio.resume();
    const id = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (attempt !== generation) return;
    const captured = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id } },
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 15 } },
    });
    if (attempt !== generation) { captured.getTracks().forEach((track) => track.stop()); return; }
    stream = captured;
    // Tab capture mutes local playback; route it back so the host hears games.
    audio.createMediaStreamSource(stream).connect(audio.destination);
    stream.getVideoTracks()[0].addEventListener('ended', () => stop('Chrome stopped sharing the game tab.'));
    const url = new URL('/ws', link.origin);
    url.protocol = link.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = socket = new WebSocket(url);
    connectTimeout = setTimeout(() => stop('The sharing server did not respond. Check the link and try again.'), 10_000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: secret }));
    ws.onmessage = ({ data }) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'ready' && message.role === 'publisher') {
          clearTimeout(connectTimeout);
          starting = false;
          record();
          metadata();
          heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}'); }, 20_000);
          statusEl.textContent = 'Sharing video and game audio. Stop here when you’re done.';
          chrome.tabs.update(tabId, { active: true }).catch(() => stop('The game tab was closed.'));
        } else if (message.type === 'restart') {
          clearTimeout(restartTimer);
          restartTimer = setTimeout(record, 200);
        }
      } catch { stop('The sharing server sent an invalid response.'); }
    };
    ws.onerror = () => stop('Cannot connect to the sharing server. Check the link and try again.');
    ws.onclose = (event) => stop(event.reason || 'Disconnected. Start sharing again to reconnect.');
  } catch (error) { if (attempt === generation) stop(error.message); }
};
stopButton.onclick = () => stop();
chrome.tabs.onUpdated.addListener((id, change) => { if (id === tabId && (change.url || change.status === 'complete')) metadata(); });
chrome.tabs.onRemoved.addListener((id) => { if (id === tabId) { stop('The game tab was closed.'); startButton.disabled = true; } });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && (changes.completions || changes.states)) metadata(); });
window.addEventListener('pagehide', () => stop());
metadata();
