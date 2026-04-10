function getMontrealDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

// Step 1: Identify current site
const currentSite = SITES.find((site) => matchesSite(location.href, site.url));

console.log('[tijeux] current site:', currentSite?.url ?? 'not in carousel');

if (!currentSite) {
  // Not a tracked site — do nothing
} else {
  chrome.storage.sync.get(['states', 'completions'], (data) => {
    const states = data.states || {};
    const completions = data.completions || {};

    const activeSites = SITES.filter((s) => states[s.url] !== false);
    const currentIndex = activeSites.findIndex((s) => matchesSite(location.href, s.url));

    if (currentIndex === -1) {
      console.log('[tijeux] site is disabled, skipping');
      return;
    }

    const today = getMontrealDate();
    const alreadyCompleted = completions[currentSite.url] === today;

    // Step 2: Inject navbar
    const navbarShadow = injectNavbar(currentIndex, activeSites.length, alreadyCompleted);

    // Step 3: Completion detection
    if ((currentSite.completedCondition || currentSite.messageCondition) && !alreadyCompleted) {
      let triggered = false;

      function onCompleted() {
        if (triggered) return;
        triggered = true;
        console.log('[tijeux] completed condition met');

        // Write completion to storage
        chrome.storage.sync.get(['completions'], (result) => {
          const updatedCompletions = result.completions || {};
          updatedCompletions[currentSite.url] = getMontrealDate();
          chrome.storage.sync.set({ completions: updatedCompletions });
        });

        // Update navbar badge
        const countSpan = navbarShadow.getElementById('count');
        if (countSpan) {
          countSpan.textContent = `${currentIndex + 1} / ${activeSites.length} ✓`;
          countSpan.classList.add('completed');
        }

        // Step 4: Show completion overlay
        showCompletionOverlay(activeSites, currentSite, completions, today);
      }

      if (currentSite.completedCondition) {
        const observer = new MutationObserver(() => {
          if (!triggered && currentSite.completedCondition()) {
            observer.disconnect();
            onCompleted();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        if (!triggered && currentSite.completedCondition()) { observer.disconnect(); onCompleted(); }
      }

      if (currentSite.messageCondition) {
        const onMessage = (e) => {
          if (currentSite.messageCondition(e)) {
            window.removeEventListener('message', onMessage);
            onCompleted();
          }
        };
        window.addEventListener('message', onMessage);
      }
    }
  });
}

function injectNavbar(currentIndex, total, alreadyCompleted) {
  const host = document.createElement('div');
  host.id = 'tijeux-navbar-host';
  Object.assign(host.style, {
    position: 'fixed',
    bottom: '0',
    left: '0',
    right: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });

  const shadow = host.attachShadow({ mode: 'closed' });
  const countText = alreadyCompleted
    ? `${currentIndex + 1} / ${total} ✓`
    : `${currentIndex + 1} / ${total}`;

  shadow.innerHTML = `
    <style>
      nav {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 6px 16px;
        background: rgba(20, 20, 20, 0.85);
        backdrop-filter: blur(6px);
        color: #fff;
        font: 13px/1 system-ui, sans-serif;
        pointer-events: all;
      }
      button {
        background: none;
        border: 1px solid rgba(255,255,255,0.3);
        color: #fff;
        border-radius: 4px;
        padding: 3px 10px;
        cursor: pointer;
        font-size: 13px;
      }
      button:hover {
        background: rgba(255,255,255,0.15);
      }
      #count {
        opacity: 0.7;
        min-width: 40px;
        text-align: center;
      }
      #count.completed {
        opacity: 1;
        color: #4caf50;
        font-weight: 600;
      }
    </style>
    <nav>
      <button id="prev">← prev</button>
      <span id="count" ${alreadyCompleted ? 'class="completed"' : ''}>${countText}</span>
      <button id="next">next →</button>
    </nav>
  `;

  shadow.getElementById('prev').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'navigate', direction: 'prev' });
  });

  shadow.getElementById('next').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'navigate', direction: 'next' });
  });

  document.body.appendChild(host);
  console.log('[tijeux] navbar injected at index', currentIndex, '/', total);

  return shadow;
}

function showCompletionOverlay(activeSites, currentSite, completions, today) {
  // Find up to 2 next incomplete active sites (excluding current)
  const incompleteSites = activeSites.filter(
    (s) => s.url !== currentSite.url && completions[s.url] !== today
  );
  const nextSites = incompleteSites.slice(0, 2);

  const host = document.createElement('div');
  host.id = 'tijeux-overlay-host';
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '2147483646',
    pointerEvents: 'all',
  });

  const shadow = host.attachShadow({ mode: 'closed' });

  const nextSitesHTML =
    nextSites.length > 0
      ? `
        <p class="subtext">Up next:</p>
        <div class="next-buttons">
          ${nextSites
            .map(
              (s) =>
                `<button class="site-btn" data-url="${s.url}">${s.name}</button>`
            )
            .join('')}
        </div>
      `
      : `<p class="subtext">All games complete for today!</p>`;

  shadow.innerHTML = `
    <style>
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        font: 14px/1.5 system-ui, sans-serif;
      }
      .card {
        position: relative;
        background: #fff;
        color: #111;
        width: 320px;
        padding: 24px;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
        text-align: center;
      }
      .close-btn {
        position: absolute;
        top: 10px;
        right: 12px;
        background: none;
        border: none;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        color: #555;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .close-btn:hover {
        background: #f0f0f0;
        color: #111;
      }
      h2 {
        margin: 0 0 12px;
        font-size: 22px;
        font-weight: 700;
      }
      .subtext {
        margin: 0 0 16px;
        color: #555;
        font-size: 13px;
      }
      .next-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .site-btn {
        background: #111;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 10px 16px;
        font-size: 14px;
        cursor: pointer;
        font-family: system-ui, sans-serif;
      }
      .site-btn:hover {
        background: #333;
      }
    </style>
    <div class="backdrop">
      <div class="card">
        <button class="close-btn" id="close-overlay">×</button>
        <h2>Done!</h2>
        ${nextSitesHTML}
      </div>
    </div>
  `;

  shadow.getElementById('close-overlay').addEventListener('click', () => {
    host.remove();
  });

  shadow.querySelectorAll('.site-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.location.href = btn.dataset.url;
    });
  });

  document.body.appendChild(host);
  console.log('[tijeux] completion overlay shown');
}
