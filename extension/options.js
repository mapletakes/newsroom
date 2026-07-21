const DEFAULT_APP_URL = 'https://thebroadside.net';

const tokenEl = document.getElementById('token');
const appUrlEl = document.getElementById('appUrl');
const targetEl = document.getElementById('target');
const statusEl = document.getElementById('status');

let savedDefaultTarget = null;

function targetToValue(t) {
  if (t && t.type === 'shelf') return `shelf:${t.listId}`;
  return `deck:${(t && t.segmentId) || ''}`;
}

async function loadTargets() {
  const token = tokenEl.value.trim();
  const appUrl = (appUrlEl.value.trim() || DEFAULT_APP_URL).replace(/\/+$/, '');

  targetEl.innerHTML = '<option value="deck:">Live Deck — Ungrouped</option>';
  if (!token) return;

  try {
    const [segRes, shelfRes] = await Promise.all([
      fetch(`${appUrl}/api/deck/segments`, { headers: { 'X-Add-Token': token } }),
      fetch(`${appUrl}/api/lists/quick-add-targets`, { headers: { 'X-Add-Token': token } }),
    ]);
    const segments = segRes.ok ? (await segRes.json()).segments || [] : [];
    const shelves = shelfRes.ok ? (await shelfRes.json()).shelves || [] : [];

    if (segments.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'Live Deck';
      for (const s of segments) {
        const opt = document.createElement('option');
        opt.value = `deck:${s.id}`;
        opt.textContent = s.name || 'Segment';
        group.appendChild(opt);
      }
      targetEl.appendChild(group);
    }

    if (shelves.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'Shelves';
      for (const s of shelves) {
        const opt = document.createElement('option');
        opt.value = `shelf:${s.id}`;
        opt.textContent = s.name || 'Shelf';
        group.appendChild(opt);
      }
      targetEl.appendChild(group);
    }
  } catch (e) {
    // Leave just the default option — the token or URL is probably wrong.
  }

  if (savedDefaultTarget) targetEl.value = targetToValue(savedDefaultTarget);
}

chrome.storage.local.get(['token', 'appUrl', 'defaultTarget'], ({ token, appUrl, defaultTarget }) => {
  tokenEl.value = token || '';
  appUrlEl.value = appUrl || DEFAULT_APP_URL;
  savedDefaultTarget = defaultTarget || null;
  loadTargets();
});

tokenEl.addEventListener('change', loadTargets);
appUrlEl.addEventListener('change', loadTargets);

document.getElementById('save').addEventListener('click', () => {
  const token = tokenEl.value.trim();
  const appUrl = (appUrlEl.value.trim() || DEFAULT_APP_URL).replace(/\/+$/, '');
  const [kind, id] = (targetEl.value || 'deck:').split(':');
  const defaultTarget = kind === 'shelf' ? { type: 'shelf', listId: id } : { type: 'deck', segmentId: id || null };
  savedDefaultTarget = defaultTarget;
  chrome.storage.local.set({ token, appUrl, defaultTarget }, () => {
    statusEl.textContent = 'Saved ✓';
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
  });
});
