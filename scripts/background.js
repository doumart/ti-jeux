importScripts('sites.js');

function getActiveSites(states) {
  return SITES.map((s) => s.url).filter((url) => states[url] !== false);
}

function findCurrentIndex(sites, tabUrl) {
  return sites.findIndex((url) => {
    try {
      return new URL(tabUrl).origin === new URL(url).origin;
    } catch {
      return false;
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  console.log('[tijeux] message received:', message.type, 'from:', sender.tab?.url);

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
