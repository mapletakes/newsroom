// Page archiving via archive.today (archive.ph). It renders JavaScript and
// gets past most paywalls / soft blocks, which the Wayback Machine struggles
// with.
//
// Caveat: archive.today is behind Cloudflare and often blocks datacenter IPs
// (e.g. Vercel), so a server-side capture isn't guaranteed. We therefore store
// the deterministic "newest" link — https://archive.today/newest/<url> — which
// redirects to the latest snapshot, or offers to create one when first opened
// in a real browser. We also attempt a best-effort capture so a snapshot often
// exists already by the time anyone clicks.

const BASE = 'https://archive.today';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const SNAPSHOT_RE = /archive\.(?:today|ph|is|li|md|fo|vn)\/[A-Za-z0-9]+/;

// A link that always resolves: to the latest snapshot if one exists, otherwise
// to archive.today's save prompt for this URL.
export function newestLink(url: string): string {
  return `${BASE}/newest/${url}`;
}

export async function requestArchive(url: string): Promise<string | null> {
  // Best-effort server-side capture (may be Cloudflare-blocked).
  try {
    const res = await fetch(`${BASE}/submit/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
      },
      body: new URLSearchParams({ url, anyway: '1' }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    });

    // A fresh/existing snapshot comes back via the Refresh or Location header.
    const refresh = res.headers.get('refresh');
    const fromRefresh = refresh && /url=(\S+)/i.exec(refresh)?.[1];
    const candidate = fromRefresh || res.headers.get('location') || '';
    if (SNAPSHOT_RE.test(candidate)) {
      return candidate.replace(/^http:/, 'https:');
    }
  } catch {
    /* Cloudflare / timeout — fall back to the deterministic link */
  }

  return newestLink(url);
}
