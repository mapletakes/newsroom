export type TwitterMeta = {
  title: string | null;
  description: string | null;
  author: string | null;
  authorHandle: string | null;
  thumbnail: string | null;
};

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractTwitter(url: string): Promise<TwitterMeta> {
  const empty: TwitterMeta = {
    title: null, description: null, author: null, authorHandle: null, thumbnail: null,
  };

  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
    const r = await fetch(oembedUrl, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return empty;
    const data = await r.json();

    const author = data.author_name || null;

    let authorHandle: string | null = null;
    if (data.author_url) {
      const match = data.author_url.match(/(?:twitter\.com|x\.com)\/(\w+)/);
      if (match) authorHandle = `@${match[1]}`;
    }

    let tweetText: string | null = null;
    if (data.html) {
      // The oEmbed HTML is a <blockquote> containing <p> tags with the tweet text
      // followed by attribution. Extract just the paragraph content.
      const pMatch = data.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      if (pMatch) {
        tweetText = stripHtml(pMatch[1]);
      }
    }

    const title = author
      ? `${author} ${authorHandle ? `(${authorHandle})` : ''}`
      : null;

    return {
      title: title?.trim() || null,
      description: tweetText,
      author,
      authorHandle,
      thumbnail: null,
    };
  } catch {
    return empty;
  }
}
