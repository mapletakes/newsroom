// Newsroom Quick Add — MV3 background service worker.
// Toolbar click adds the current tab; right-click context menu adds a page,
// link, video, or selected URL. Auth is the personal add token.

const DEFAULT_APP_URL = 'https://newsroom-psi-five.vercel.app';

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

async function addUrl(url) {
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
      body: JSON.stringify({ url }),
    });
    flashBadge(r.ok);
  } catch (e) {
    flashBadge(false);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'nr-add',
    title: 'Add to Newsroom',
    contexts: ['page', 'link', 'selection', 'video'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Prefer the specific thing under the cursor (a link or video), then a
  // selected URL, then the page itself.
  let url = info.linkUrl || info.srcUrl;
  const sel = (info.selectionText || '').trim();
  if (!url && /^https?:\/\/\S+$/i.test(sel)) url = sel;
  if (!url) url = info.pageUrl || (tab && tab.url);
  addUrl(url);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.url) addUrl(tab.url);
});
