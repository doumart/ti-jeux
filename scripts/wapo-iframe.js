// Runs in MAIN world inside the Arkadium crossword iframe on arkadiumhosted.com.
// Polls the iframe's own window.dataLayer for a Game_End entry and relays it
// to the parent page (games.washingtonpost.com) via postMessage so that
// content.js (running on the parent) can react via its messageCondition.
(function () {
  let acked = false;
  window.addEventListener('message', (e) => {
    if (e.data?.tijeux === 'game-end-ack') acked = true;
  });

  const interval = setInterval(() => {
    const dl = window.dataLayer;
    if (Array.isArray(dl) && dl.some((item) => item?.[1] === 'Game_End')) {
      clearInterval(interval);
      const send = () =>
        window.parent.postMessage({ tijeux: 'game-end' }, 'https://games.washingtonpost.com');
      send();
      // Resend until the parent acks, so a not-yet-armed listener can't lose it.
      const resend = setInterval(() => (acked ? clearInterval(resend) : send()), 2000);
      setTimeout(() => clearInterval(resend), 60 * 1000);
    }
  }, 1000);

  // Stop polling after 2 hours.
  setTimeout(() => clearInterval(interval), 2 * 60 * 60 * 1000);
})();
