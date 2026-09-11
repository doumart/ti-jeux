// Runs inside the LinkedIn game iframe (www.linkedin.com/games/view/<game>/desktop).
// The whole game — including the end-of-game results panel — renders in that
// iframe, so the parent page (/games/pinpoint/, /games/crossclimb/) never sees
// `.pr-game-results__components` and a completedCondition on the parent can
// never fire. Relay completion to the parent via postMessage instead, where
// content.js picks it up through its messageCondition.
//
// Same-origin as the parent, so the default isolated world is enough. The
// iframe hosts exactly one game — the one the parent page is showing — so the
// message needs no game id: only that parent is listening.
(function () {
  let acked = false;
  window.addEventListener('message', (e) => {
    if (e.data?.tijeux === 'game-end-ack') acked = true;
  });

  const interval = setInterval(() => {
    if (!document.querySelector('.pr-game-results__components')) return;
    clearInterval(interval);
    const send = () => window.parent.postMessage({ tijeux: 'game-end' }, 'https://www.linkedin.com');
    send();
    // Resend until the parent acks, so a not-yet-armed listener can't lose it.
    const resend = setInterval(() => (acked ? clearInterval(resend) : send()), 2000);
    setTimeout(() => clearInterval(resend), 60 * 1000);
  }, 1000);

  // Stop polling after 2 hours.
  setTimeout(() => clearInterval(interval), 2 * 60 * 60 * 1000);
})();
