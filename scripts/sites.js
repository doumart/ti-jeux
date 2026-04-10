// Returns true if href is on the same origin and path-prefix as siteUrl.
// This ensures two sites on the same domain (e.g. nytimes.com) don't collide.
function matchesSite(href, siteUrl) {
  try {
    const current = new URL(href);
    const site = new URL(siteUrl);
    return current.origin === site.origin && current.pathname.startsWith(site.pathname);
  } catch {
    return false;
  }
}

// Each entry: { url, name, completedCondition? }
// completedCondition: () => boolean — called in the page context to detect completion
const SITES = [
  {
    url: "https://www.nytimes.com/games/connections",
    name: "NYT Connections",
    completedCondition: () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === 'Share Your Results' || b.textContent.trim() === 'Admire puzzle'
      )
  },
  {
    url: "https://www.nytimes.com/crosswords/game/mini",
    name: "NYT Mini",
    completedCondition: () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === 'Share your results'
      )
  },
  {
    url: "https://guessthe.game/",
    name: "Guess the Game",
    completedCondition: () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === 'Share Results'
      )
  },
  {
    url: "https://guessthemovie.name/",
    name: "Guess the Movie",
    completedCondition: () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === 'Share Results'
      )
  },
  {
    url: "https://guesstheaudio.com/",
    name: "Guess the Audio",
    completedCondition: () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === 'Share Results'
      )
  },
  {
    url: "https://games.washingtonpost.com/games/daily-crossword-mini",
    name: "WaPo Crossword",
    // wapo-completion.js polls window.dataLayer for Game_End and relays via postMessage.
    messageCondition: (e) => e.data?.tijeux === 'game-end',
  },
  {
    url: "https://www.theatlantic.com/games/bracket-city/",
    name: "Bracket City",
    completedCondition: () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === 'Share Result'
      )
  },
  {
    url: "https://www.linkedin.com/games/pinpoint/",
    name: "Pinpoint",
    completedCondition: () =>
      Array.from(document.querySelectorAll('.pr-game-results__components')).length >0
  },
  {
    url: "https://bandle.app/menu",
    name: "Bandle",
    completedCondition: () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === 'Play more Songs'
      )
  },
  {
    url: "https://glyph.today/",
    name: "Glyph",
    completedCondition: () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === '📋 Share Your Win!'
      )
  },
];
