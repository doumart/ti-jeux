function getMontrealDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

function isSiteCompletedToday(completions, url) {
  return completions[url] === getMontrealDate();
}

// chrome.runtime.openOptionsPage() rejects intermittently with "Could not
// create an options page" when called from a popup (opening the tab tears down
// the popup context mid-promise). options_page opens in a tab anyway, so open
// it directly — reliable and single-tab.
function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('ui/options.html') });
  window.close();
}

chrome.storage.sync.get(['states', 'completions'], (data) => {
  const states = data.states || {};
  const completions = data.completions || {};

  const activeSites = SITES.filter((s) => states[s.url] !== false);
  const completedCount = activeSites.filter((s) => isSiteCompletedToday(completions, s.url)).length;
  const incompleteSites = activeSites.filter((s) => !isSiteCompletedToday(completions, s.url));

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const currentUrl = tab?.url || '';

    const currentSite = activeSites.find((s) => matchesSite(currentUrl, s.url));

    const homeView = document.getElementById('home-view');
    const siteView = document.getElementById('site-view');

    if (!currentSite) {
      // Home view
      homeView.classList.remove('hidden');
      siteView.classList.add('hidden');

      document.getElementById('progress-text').textContent =
        `${completedCount} / ${activeSites.length} done today`;

      const actionBtn = document.getElementById('action-btn');
      const allDoneMsg = document.getElementById('all-done-msg');

      if (activeSites.length === 0) {
        actionBtn.textContent = 'Open Settings';
        actionBtn.classList.remove('hidden');
        actionBtn.addEventListener('click', openSettings);
      } else if (incompleteSites.length > 0 && completedCount === 0) {
        actionBtn.textContent = 'Start';
        actionBtn.classList.remove('hidden');
        actionBtn.addEventListener('click', () => {
          chrome.tabs.create({ url: incompleteSites[0].url });
          window.close();
        });
      } else if (incompleteSites.length > 0 && completedCount > 0) {
        actionBtn.textContent = 'Resume';
        actionBtn.classList.remove('hidden');
        actionBtn.addEventListener('click', () => {
          chrome.tabs.create({ url: incompleteSites[0].url });
          window.close();
        });
      } else {
        // All done
        actionBtn.classList.add('hidden');
        allDoneMsg.classList.remove('hidden');
      }
    } else {
      // Site view
      homeView.classList.add('hidden');
      siteView.classList.remove('hidden');

      const siteList = document.getElementById('site-list');

      activeSites.forEach((site) => {
        const item = document.createElement('div');
        item.className = 'site-item';

        if (site === currentSite) {
          item.classList.add('current-site');
        }

        if (isSiteCompletedToday(completions, site.url)) {
          item.classList.add('completed');
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'site-name';
        nameSpan.textContent = site.name;

        item.appendChild(nameSpan);

        if (isSiteCompletedToday(completions, site.url)) {
          const check = document.createElement('span');
          check.className = 'checkmark';
          check.textContent = 'Done';
          item.appendChild(check);
        }

        item.addEventListener('click', () => {
          chrome.tabs.update(tab.id, { url: site.url });
          window.close();
        });

        siteList.appendChild(item);
      });

      document.getElementById('settings-link').addEventListener('click', (e) => {
        e.preventDefault();
        openSettings();
      });
    }
  });
});
