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

  try {
    const inputHost = new URL(input.url).hostname.replace(/^www\./, '');
    const u = new URL('https://api.search.brave.com/res/v1/web/search');
    u.searchParams.set('q', query);
    u.searchParams.set('count', '10');
    u.searchParams.set('search_lang', 'en');
    u.searchParams.set('freshness', 'pm'); // past month

    const r = await fetch(u, {
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const data = await r.json();

    const results: CoverageResult[] = [];
    for (const item of data.web?.results || []) {
      // Skip the original source
      let host: string;
      try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch { continue; }
      if (host === inputHost) continue;

      results.push({
        title: item.title || '',
        url: item.url,
        publisher: host,
        snippet: item.description || '',
      });
      if (results.length >= 5) break;
    }
    return results;
  } catch {
    return [];
  }
}
