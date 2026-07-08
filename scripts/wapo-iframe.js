// Runs in MAIN world inside the Arkadium crossword iframe on arkadiumhosted.com.
// Polls for game completion and relays it to the parent page
// (games.washingtonpost.com) via postMessage so that content.js (running on
// the parent) can react via its messageCondition. Two independent signals:
// - window.dataLayer gets a gtag 'Game_End' event (absent when analytics is
//   blocked by ad blockers / declined cookie consent)
// - the game's results dialog (gameEndPopup_* CSS-module classes) appears
(function () {
  let acked = false;
  window.addEventListener('message', (e) => {
    if (e.data?.tijeux === 'game-end-ack') acked = true;
  });

  const interval = setInterval(() => {
    const dl = window.dataLayer;
    // ponytail: gameEndPopup also shows when reviewing an already-solved
    // archive puzzle; scope the selector to today's puzzle if that ever bites.
    if ((Array.isArray(dl) && dl.some((item) => item?.[1] === 'Game_End')) ||
        document.querySelector('[class*="gameEndPopup"]')) {
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
