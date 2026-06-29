// The Broadside Quick Add — MV3 background service worker.
// Toolbar click adds the current tab; right-click context menu adds a page,
// link, video, or selected URL — and, when segments exist, lets you pick which
// segment of the deck to drop it into. Auth is the personal add token.

const DEFAULT_APP_URL = 'https://newsroom-psi-five.vercel.app';
const CONTEXTS = ['page', 'link', 'selection', 'video'];
const SEG_PREFIX = 'nr-seg:';

async function getConfig() {
  const { token, appUrl } = await chrome.storage.sync.get(['token', 'appUrl']);
  return {
    token: token || '',
    appUrl: (appUrl || DEFAULT_APP_URL).replace(/\/+$/, ''),
  };
}

function flashBadge(ok) {
  chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#3a7d44' : '#b23a2e' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1600);
}

async function addUrl(url, segmentId) {
  if (!url) return;
  const { token, appUrl } = await getConfig();
  if (!token) {
    // Not configured yet — send them to set the token.
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    const r = await fetch(`${appUrl}/api/deck/quick-add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Add-Token': token },
      body: JSON.stringify({ url, segmentId: segmentId || null }),
    });
    flashBadge(r.ok);
  } catch (e) {
    flashBadge(false);
  }
}

// --- Context menu (rebuilt with the current segment list) ---

async function fetchSegments() {
  const { token, appUrl } = await getConfig();
  if (!token) return [];
  try {
    const r = await fetch(`${appUrl}/api/deck/segments`, {
      headers: { 'X-Add-Token': token },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.segments) ? data.segments : [];
  } catch (e) {
    return [];
  }
}

let rebuilding = false;
async function rebuildMenus() {
  if (rebuilding) return;
  rebuilding = true;
  try {
    const segments = await fetchSegments();
    await chrome.contextMenus.removeAll();

    // No segments (or not signed in) → a single plain "Add to The Broadside".
    if (segments.length === 0) {
      chrome.contextMenus.create({ id: 'nr-add', title: 'Add to The Broadside', contexts: CONTEXTS });
      return;
    }

    // Otherwise a submenu: ungrouped first, then each segment.
    chrome.contextMenus.create({ id: 'nr-add', title: 'Add to The Broadside', contexts: CONTEXTS });
    chrome.contextMenus.create({
      id: `${SEG_PREFIX}ungrouped`,
      parentId: 'nr-add',
      title: 'Ungrouped (no segment)',
      contexts: CONTEXTS,
    });
    chrome.contextMenus.create({ id: 'nr-sep', parentId: 'nr-add', type: 'separator', contexts: CONTEXTS });
    for (const s of segments) {
      chrome.contextMenus.create({
        id: `${SEG_PREFIX}${s.id}`,
        parentId: 'nr-add',
        title: s.name || 'Segment',
        contexts: CONTEXTS,
      });
    }
  } finally {
    rebuilding = false;
  }
}

// --- Wiring ---

chrome.runtime.onInstalled.addListener(() => {
  rebuildMenus();
  chrome.alarms.create('nr-refresh', { periodInMinutes: 5 });
});

chrome.runtime.onStartup.addListener(() => {
  rebuildMenus();
  chrome.alarms.create('nr-refresh', { periodInMinutes: 5 });
});

// Keep the segment list reasonably fresh (no contextMenus.onShown in Chrome).
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'nr-refresh') rebuildMenus();
});

// Rebuild as soon as the token or app URL changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.token || changes.appUrl)) rebuildMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Prefer the specific thing under the cursor (a link or video), then a
  // selected URL, then the page itself.
  let url = info.linkUrl || info.srcUrl;
  const sel = (info.selectionText || '').trim();
  if (!url && /^https?:\/\/\S+$/i.test(sel)) url = sel;
  if (!url) url = info.pageUrl || (tab && tab.url);

  // Which segment was chosen (ungrouped, or none = the plain menu item).
  const id = String(info.menuItemId);
  let segmentId = null;
  if (id.startsWith(SEG_PREFIX)) {
    const seg = id.slice(SEG_PREFIX.length);
    segmentId = seg === 'ungrouped' ? null : seg;
  }
  addUrl(url, segmentId);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.url) addUrl(tab.url, null);
});
