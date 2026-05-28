export type CoverageResult = {
  title: string;
  url: string;
  publisher: string;
  snippet: string;
};

export async function searchRelatedCoverage(input: {
  title: string | null;
  publisher: string | null;
  url: string;
  preferredSources?: string[];
}): Promise<CoverageResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];

  // Build a search query from the article title, stripping the publisher name
  // so we find coverage from OTHER outlets
  let query = input.title || '';
  if (input.publisher && query.toLowerCase().includes(input.publisher.toLowerCase())) {
    query = query.replace(new RegExp(input.publisher, 'gi'), '').trim();
  }
  // Strip common title suffixes like "- The New York Times"
  query = query.replace(/\s*[-|–—]\s*[^-|–—]+$/, '').trim();
  if (query.length < 10) return [];

  const preferred = (input.preferredSources || []).map((s) => s.toLowerCase());

  try {
    const inputHost = new URL(input.url).hostname.replace(/^www\./, '');

    // If preferred sources are configured, run a targeted search for those
    // domains alongside the general search
    const fetches: Promise<CoverageResult[]>[] = [];

    // General search
    fetches.push(braveSearch(query, inputHost, apiKey, 10));

    // Targeted search scoped to preferred domains (if any)
    if (preferred.length > 0) {
      const siteQuery = `${query} (${preferred.map((s) => `site:${s}`).join(' OR ')})`;
      fetches.push(braveSearch(siteQuery, inputHost, apiKey, 5));
    }

    const [general, targeted] = await Promise.all(fetches);

    // Merge: preferred-source results first (deduped), then general
    const seen = new Set<string>();
    const merged: CoverageResult[] = [];

    // Targeted results first
    for (const r of targeted || []) {
      if (!seen.has(r.url)) { seen.add(r.url); merged.push(r); }
    }

    // Then general results, with preferred sources sorted ahead of others
    const preferredGeneral: CoverageResult[] = [];
    const otherGeneral: CoverageResult[] = [];
    for (const r of general) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      const host = r.publisher.toLowerCase();
      if (preferred.some((p) => host === p || host.endsWith(`.${p}`))) {
        preferredGeneral.push(r);
      } else {
        otherGeneral.push(r);
      }
    }
    merged.push(...preferredGeneral, ...otherGeneral);

    return merged.slice(0, 3);
  } catch {
    return [];
  }
}

async function braveSearch(
  query: string,
  excludeHost: string,
  apiKey: string,
  count: number,
): Promise<CoverageResult[]> {
  const u = new URL('https://api.search.brave.com/res/v1/web/search');
  u.searchParams.set('q', query);
  u.searchParams.set('count', String(count));
  u.searchParams.set('search_lang', 'en');
  u.searchParams.set('freshness', 'pm');

  const r = await fetch(u, {
    headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return [];
  const data = await r.json();

  const results: CoverageResult[] = [];
  for (const item of data.web?.results || []) {
    let host: string;
    try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch { continue; }
    if (host === excludeHost) continue;
    results.push({
      title: item.title || '',
      url: item.url,
      publisher: host,
      snippet: item.description || '',
    });
  }
  return results;
}
