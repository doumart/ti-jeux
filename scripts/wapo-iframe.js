// Runs in MAIN world inside the Arkadium crossword iframe on arkadiumhosted.com.
// Polls the iframe's own window.dataLayer for a Game_End entry and relays it
// to the parent page (games.washingtonpost.com) via postMessage so that
// wapo-completion.js (running on the parent) can react.
(function () {
  let fired = false;

  const interval = setInterval(() => {
    if (fired) { clearInterval(interval); return; }
    const dl = window.dataLayer;
    if (Array.isArray(dl) && dl.some((item) => item?.[1] === 'Game_End')) {
      fired = true;
      clearInterval(interval);
      window.parent.postMessage({ tijeux: 'game-end' }, 'https://games.washingtonpost.com');
    }
  }, 1000);

  // Stop polling after 2 hours.
  setTimeout(() => clearInterval(interval), 2 * 60 * 60 * 1000);
})();
