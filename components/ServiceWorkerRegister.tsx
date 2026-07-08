'use client';

import { useEffect } from 'react';

// Registers the app-shell service worker so the mod view can be installed to
// a phone home screen. No-ops silently wherever service workers aren't
// available (older browsers, some in-app webviews).
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
