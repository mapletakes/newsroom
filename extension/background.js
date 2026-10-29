// The Broadside Quick Add — MV3 background script (a true service worker on
// Chrome/Edge; an event page on Firefox, which doesn't support service_worker
// — see manifest.json's background key for both).
// Toolbar click adds the current tab to your saved default destination.
// Right-click context menu adds a page, link, video, or selected URL, and
// lets you pick where it goes: a segment of the live deck, or a shelf (for
// pre-show research — see The Broadside → Shelf). "Archive this page"
// snapshots the page as this browser shows it (see capture.js). Auth is the
// personal add token.

const DEFAULT_APP_URL = 'https://thebroadside.net';
const CONTEXTS = ['page', 'link', 'selection', 'video'];
const SEG_PREFIX = 'nr-seg:';
const SHELF_PREFIX = 'nr-shelf:';

async function getConfig() {
  const { token, appUrl, defaultTarget, scrubTerms } = await chrome.storage.local.get([
    'token',
    'appUrl',
    'defaultTarget',
    'scrubTerms',
  ]);
  return {
    token: token || '',
    appUrl: (appUrl || DEFAULT_APP_URL).replace(/\/+$/, ''),
    defaultTarget: defaultTarget || { type: 'deck', segmentId: null },
    scrubTerms: Array.isArray(scrubTerms) ? scrubTerms : [],
  };
}

function flashBadge(ok) {
  chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#3a7d44' : '#b23a2e' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1600);
}

// `target` is { type: 'deck', segmentId } or { type: 'shelf', listId }.
async function addUrl(url, target) {
  if (!url) return;
  const { token, appUrl } = await getConfig();
  if (!token) {
    // Not configured yet — send them to set the token.
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    const r = target && target.type === 'shelf'
      ? await fetch(`${appUrl}/api/lists/quick-add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Add-Token': token },
          body: JSON.stringify({ url, listId: target.listId }),
        })
      : await fetch(`${appUrl}/api/deck/quick-add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Add-Token': token },
          body: JSON.stringify({ url, segmentId: (target && target.segmentId) || null }),
        });
    flashBadge(r.ok);
  } catch (e) {
    flashBadge(false);
  }
}

// --- Archive this page ---

// Snapshots the tab as this browser renders it — signed in, past any paywall
// the reader has access to, on sites that refuse The Broadside's server — and
// sends it (gzipped) to be frozen and published. The snapshot then opens in
// a new tab, so the reader can check nothing of theirs slipped through.
async function archiveTab(tab) {
  if (!tab || !tab.id || !/^https?:/i.test(tab.url || '')) return;
  const { token, appUrl, scrubTerms } = await getConfig();
  if (!token) {
    chrome.runtime.openOptionsPage();
    return;
  }
  chrome.action.setBadgeText({ text: '…' });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (terms) => { globalThis.__broadsideScrubTerms = terms; },
      args: [scrubTerms],
    });
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    const page = injection && injection.result;
    if (!page || !page.html) throw new Error('capture failed');

    const json = JSON.stringify({ url: page.url || tab.url, html: page.html });
    const gzipped = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const r = await fetch(`${appUrl}/api/archive/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Add-Token': token, 'X-Content-Encoding': 'gzip' },
      body: gzipped,
    });
    const data = await r.json().catch(() => ({}));
    flashBadge(r.ok && !!data.archive_url);
    if (r.ok && data.archive_url) chrome.tabs.create({ url: data.archive_url, index: tab.index + 1 });
  } catch (e) {
    flashBadge(false);
  }
}

// --- Context menu (rebuilt with the current segment + shelf list) ---

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

async function fetchShelves() {
  const { token, appUrl } = await getConfig();
  if (!token) return [];
  try {
    const r = await fetch(`${appUrl}/api/lists/quick-add-targets`, {
      headers: { 'X-Add-Token': token },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.shelves) ? data.shelves : [];
  } catch (e) {
    return [];
  }
}

let rebuilding = false;
async function rebuildMenus() {
  if (rebuilding) return;
  rebuilding = true;
  try {
    const [segments, shelves] = await Promise.all([fetchSegments(), fetchShelves()]);
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: 'nr-archive', title: 'Archive this page in The Broadside', contexts: ['page'] });

    // Nothing configured yet (or not signed in) → a single plain item,
    // straight to the live deck's ungrouped list.
    if (segments.length === 0 && shelves.length === 0) {
      chrome.contextMenus.create({ id: 'nr-add', title: 'Add to The Broadside', contexts: CONTEXTS });
      return;
    }

    chrome.contextMenus.create({ id: 'nr-add', title: 'Add to The Broadside', contexts: CONTEXTS });

    // Live deck destination — a submenu of segments once any exist, else a
    // single leaf straight to ungrouped.
    if (segments.length === 0) {
      chrome.contextMenus.create({ id: `${SEG_PREFIX}ungrouped`, parentId: 'nr-add', title: 'Live Deck', contexts: CONTEXTS });
    } else {
      chrome.contextMenus.create({ id: 'nr-deck', parentId: 'nr-add', title: 'Live Deck', contexts: CONTEXTS });
      chrome.contextMenus.create({
        id: `${SEG_PREFIX}ungrouped`,
        parentId: 'nr-deck',
        title: 'Ungrouped (no segment)',
        contexts: CONTEXTS,
      });
      chrome.contextMenus.create({ id: 'nr-deck-sep', parentId: 'nr-deck', type: 'separator', contexts: CONTEXTS });
      for (const s of segments) {
        chrome.contextMenus.create({
          id: `${SEG_PREFIX}${s.id}`,
          parentId: 'nr-deck',
          title: s.name || 'Segment',
          contexts: CONTEXTS,
        });
      }
    }

    // Shelf destinations — for pre-show research, lands in that shelf's
    // ungrouped bucket (organize into blocks from the Shelf page itself).
    if (shelves.length > 0) {
      chrome.contextMenus.create({ id: 'nr-shelf-sep', parentId: 'nr-add', type: 'separator', contexts: CONTEXTS });
      for (const s of shelves) {
        chrome.contextMenus.create({
          id: `${SHELF_PREFIX}${s.id}`,
          parentId: 'nr-add',
          title: `Shelf: ${s.name || 'Shelf'}`,
          contexts: CONTEXTS,
        });
      }
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

// Keep the segment/shelf list reasonably fresh (no contextMenus.onShown in Chrome).
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'nr-refresh') rebuildMenus();
});

// Rebuild as soon as the token or app URL changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.token || changes.appUrl)) rebuildMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'nr-archive') {
    archiveTab(tab);
    return;
  }
  // Prefer the specific thing under the cursor (a link or video), then a
  // selected URL, then the page itself.
  let url = info.linkUrl || info.srcUrl;
  const sel = (info.selectionText || '').trim();
  if (!url && /^https?:\/\/\S+$/i.test(sel)) url = sel;
  if (!url) url = info.pageUrl || (tab && tab.url);

  const id = String(info.menuItemId);
  let target = { type: 'deck', segmentId: null };
  if (id.startsWith(SEG_PREFIX)) {
    const seg = id.slice(SEG_PREFIX.length);
    target = { type: 'deck', segmentId: seg === 'ungrouped' ? null : seg };
  } else if (id.startsWith(SHELF_PREFIX)) {
    target = { type: 'shelf', listId: id.slice(SHELF_PREFIX.length) };
  }
  addUrl(url, target);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.url) return;
  const { defaultTarget } = await getConfig();
  addUrl(tab.url, defaultTarget);
});
