// Page archiving via the Internet Archive's Wayback Machine.
// Triggers a "Save Page Now" capture and returns the snapshot URL, so deleted
// or edited content keeps a receipt.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Newsroom';

// Look up the most recent existing snapshot (fast, no new capture).
async function latestSnapshot(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const snap = data?.archived_snapshots?.closest;
    return snap?.available && snap.url ? String(snap.url).replace(/^http:/, 'https:') : null;
  } catch {
    return null;
  }
}

// Trigger a fresh capture and return its snapshot URL. Falls back to the latest
// existing snapshot if Save Page Now is slow / rate-limited / blocked.
export async function requestArchive(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://web.archive.org/save/${url}`, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(25000),
    });

    // The fresh snapshot path comes back in Content-Location: /web/<ts>/<url>
    const cl = r.headers.get('content-location');
    if (cl && cl.startsWith('/web/')) {
      return `https://web.archive.org${cl}`;
    }
    // Otherwise the final URL after following redirects may be the snapshot.
    if (r.url && r.url.includes('/web/')) return r.url;
  } catch {
    /* fall through to availability lookup */
  }
  return latestSnapshot(url);
}
