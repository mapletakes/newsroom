import Anthropic from '@anthropic-ai/sdk';

export type EnrichmentResult = {
  summary: string | null;
  credibility: string | null;
  topics: string[];
  dmcaRisk: 'low' | 'medium' | 'high' | null;
};

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// Quick host-based DMCA pre-screen. Not legal advice; just a heuristic.
const HIGH_RISK_HOSTS = [
  // major studios / labels / sports leagues that have historically struck
  'fox.com', 'foxnews.com', 'foxbusiness.com',
  'disney.com', 'disneyplus.com', 'abc.com', 'abcnews.go.com',
  'wbd.com', 'hbo.com', 'max.com', 'cnn.com',
  'paramount.com', 'cbs.com', 'cbsnews.com',
  'nbcuniversal.com', 'nbc.com', 'nbcnews.com', 'peacocktv.com',
  'sonypictures.com', 'crunchyroll.com',
  'nfl.com', 'nba.com', 'mlb.com', 'nhl.com', 'espn.com',
  'spotify.com', 'music.apple.com', 'music.youtube.com',
];

export function hostDMCARisk(url: string): 'low' | 'medium' | 'high' {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (HIGH_RISK_HOSTS.some((x) => h === x || h.endsWith('.' + x))) return 'high';
    if (h.endsWith('.com') && (h.includes('news') || h.includes('media'))) return 'medium';
    return 'low';
  } catch { return 'low'; }
}

const SYSTEM_PROMPT = `You are an editorial assistant for a live political/news streamer. You read articles and videos and produce concise reaction-prep notes.

Output STRICT JSON only, no prose, no markdown fences. Schema:
{
  "summary": "3-5 sentence neutral summary of what the piece actually says. Focus on the news/argument, not the framing.",
  "credibility": "one of: mainstream | partisan-left | partisan-right | tabloid | trade | blog | social | unknown",
  "topics": ["3-6 short topic tags, lowercase, hyphen-separated, e.g. 'gaza', 'us-foreign-policy', 'tech-layoffs'"],
  "dmca_risk": "one of: low | medium | high  — based on whether reacting to this on a live Twitch stream could draw a copyright strike. Articles=low. News-org video=medium. Studio/label/sports/full-episode-TV=high."
}

Be honest about credibility. 'partisan-left' and 'partisan-right' are not insults; they describe the outlet's editorial stance. 'mainstream' means broad-spectrum legacy outlets (Reuters, AP, NYT, BBC, Globe and Mail, etc.) regardless of perceived lean.`;

export async function enrichContent(input: {
  url: string;
  title: string | null;
  publisher: string | null;
  body: string | null; // article body OR youtube description+transcript
}): Promise<EnrichmentResult> {
  const client = getClient();
  const hostRisk = hostDMCARisk(input.url);

  if (!client || !input.body) {
    return {
      summary: null,
      credibility: null,
      topics: [],
      dmcaRisk: hostRisk,
    };
  }

  const userText = `URL: ${input.url}
Publisher: ${input.publisher || 'unknown'}
Title: ${input.title || 'unknown'}

Content:
${input.body.slice(0, 5500)}`;

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    });
    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    // Combine model-suggested DMCA risk with host heuristic — take the higher
    const modelRisk = (parsed.dmca_risk as 'low' | 'medium' | 'high' | undefined) || 'low';
    const order = { low: 0, medium: 1, high: 2 };
    const finalRisk = (order[modelRisk] ?? 0) > (order[hostRisk] ?? 0) ? modelRisk : hostRisk;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      credibility: typeof parsed.credibility === 'string' ? parsed.credibility : null,
      topics: Array.isArray(parsed.topics) ? parsed.topics.slice(0, 6) : [],
      dmcaRisk: finalRisk,
    };
  } catch (err) {
    console.error('enrichContent failed', err);
    return { summary: null, credibility: null, topics: [], dmcaRisk: hostRisk };
  }
}
