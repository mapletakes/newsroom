const DEFAULT_APP_URL = 'https://thebroadside.net';

const tokenEl = document.getElementById('token');
const appUrlEl = document.getElementById('appUrl');
const statusEl = document.getElementById('status');

chrome.storage.sync.get(['token', 'appUrl'], ({ token, appUrl }) => {
  tokenEl.value = token || '';
  appUrlEl.value = appUrl || DEFAULT_APP_URL;
});

document.getElementById('save').addEventListener('click', () => {
  const token = tokenEl.value.trim();
  const appUrl = (appUrlEl.value.trim() || DEFAULT_APP_URL).replace(/\/+$/, '');
  chrome.storage.sync.set({ token, appUrl }, () => {
    statusEl.textContent = 'Saved ✓';
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
  });
});
