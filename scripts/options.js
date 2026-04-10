const urlList = document.getElementById('url-list');

let states = {};
let completions = {};

function getMontrealDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

function save() {
  chrome.storage.sync.set({ states });
}

function render() {
  urlList.innerHTML = '';

  if (SITES.length === 0) {
    urlList.innerHTML = '<div class="empty">No sites configured in sites.js.</div>';
    return;
  }

  const today = getMontrealDate();

  SITES.forEach((site) => {
    const url = site.url;
    const active = states[url] !== false;
    const doneToday = completions[url] === today;

    const item = document.createElement('div');
    item.className = `url-item${active ? '' : ' inactive'}`;

    const info = document.createElement('div');
    info.className = 'url-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'url-name-row';

    const name = document.createElement('span');
    name.className = 'url-name';
    name.textContent = site.name;

    nameRow.appendChild(name);

    if (doneToday) {
      const badge = document.createElement('span');
      badge.className = 'done-badge';
      badge.textContent = 'Done today';
      nameRow.appendChild(badge);
    }

    const urlText = document.createElement('span');
    urlText.className = 'url-text';
    urlText.textContent = url;
    urlText.title = url;

    info.appendChild(nameRow);
    info.appendChild(urlText);

    const toggle = document.createElement('button');
    toggle.className = `toggle-btn ${active ? 'on' : 'off'}`;
    toggle.textContent = active ? 'Active' : 'Off';
    toggle.addEventListener('click', () => {
      states[url] = !active;
      save();
      render();
    });

    item.appendChild(info);
    item.appendChild(toggle);
    urlList.appendChild(item);
  });
}

chrome.storage.sync.get(['states', 'completions'], (data) => {
  states = data.states || {};
  completions = data.completions || {};
  render();
});
