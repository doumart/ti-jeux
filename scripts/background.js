importScripts('sites.js');

function getActiveSites(states) {
  return SITES.map((s) => s.url).filter((url) => states[url] !== false);
}

// matchesSite (sites.js) compares origin AND path prefix. Comparing origins
// alone made same-origin siblings collide — both LinkedIn games, both NYT
// games — so "next" from the second one resolved to the first one's index and
// navigated back onto the page you were already on.
function findCurrentIndex(sites, tabUrl) {
  return sites.findIndex((url) => matchesSite(tabUrl, url));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[tijeux] message received:', message.type, 'from:', sender.tab?.url);

  // Fetch a Mini puzzle for a saved (file://) page — see mini-saved-bridge.js.
  // The X-Games-Auth-Bypass header is what the game itself sends; it makes even
  // dated archive puzzles fetchable anonymously. Responses are cached in
  // storage.local so an already-opened puzzle replays offline.
  if (message.type === 'fetch-mini') {
    const url = message.date
      ? `https://www.nytimes.com/svc/crosswords/v6/puzzle/mini/${message.date}.json`
      : 'https://www.nytimes.com/svc/crosswords/v6/puzzle/mini.json';
    const key = `mini-${message.date || 'today'}`;
    fetch(url, { headers: { 'X-Games-Auth-Bypass': 'true' } })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        chrome.storage.local.set({ [key]: json });
        sendResponse({ json });
      })
      .catch(() => chrome.storage.local.get([key], (d) => sendResponse({ json: d[key] || null })));
    return true; // async sendResponse
  }

  if (message.type === 'navigate') {
    chrome.storage.sync.get(['states'], (data) => {
      const states = data.states || {};
      const sites = getActiveSites(states);
      const currentIndex = findCurrentIndex(sites, sender.tab?.url || '');

      console.log('[tijeux] current index:', currentIndex, '/', sites.length);

      if (currentIndex === -1 || sites.length < 2) return;

      const offset = message.direction === 'prev' ? -1 : 1;
      const nextIndex = (currentIndex + offset + sites.length) % sites.length;
      const nextUrl = sites[nextIndex];

      console.log('[tijeux] navigating to:', nextUrl);
      chrome.tabs.update(sender.tab.id, { url: nextUrl });
    });
  }
});
