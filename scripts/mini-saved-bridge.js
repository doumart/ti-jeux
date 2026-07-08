// Isolated-world companion to mini-saved-main.js, on file:// pages. Reads the
// puzzle date from the saved page's filename ("Tuesday, June 23, 2026 The Mini
// puzzle — The New York Times.html"), asks background.js for that day's puzzle
// JSON (page-context fetches are CORS-blocked; the background isn't), and hands
// it to the MAIN-world interceptor via a CustomEvent.
(function () {
  'use strict';

  const name = decodeURIComponent(location.pathname);
  if (!/Mini puzzle/i.test(name)) return;

  // ponytail: matches English "Month D, YYYY" filenames only — the format
  // Chrome produces from the NYT title. Other locales: parse fails, background
  // falls back to today's puzzle.
  const m = name.match(/([A-Z][a-z]+ \d{1,2}, \d{4})/);
  const d = m ? new Date(m[1]) : null;
  const date =
    d && !isNaN(d)
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : null;

  chrome.runtime.sendMessage({ type: 'fetch-mini', date }, (resp) => {
    if (resp && resp.json) {
      document.dispatchEvent(new CustomEvent('tijeux-mini-data', { detail: resp.json }));
    } else {
      console.warn('[tijeux] mini-saved: no puzzle JSON available (offline and not cached?)');
    }
  });
})();
