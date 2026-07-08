import type { MetadataRoute } from 'next';

// Makes the mod view installable on a phone home screen — mods triage from
// their couch, and a real app icon + standalone window (no browser chrome)
// beats a bookmarked tab. scope covers the whole app so following a link to
// e.g. /setup from an installed shortcut stays inside the installed window
// rather than breaking out to the browser; start_url opens straight into
// triage, which is what a mod actually wants on their home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Broadside — Mod Triage',
    short_name: 'Broadside Mod',
    description: 'Triage chat-submitted links for The Broadside.',
    start_url: '/mod',
    scope: '/',
    display: 'standalone',
    background_color: '#F5F1E8',
    theme_color: '#C4451C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
