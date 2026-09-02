import Anthropic from '@anthropic-ai/sdk';
import { recordUsage } from './usage';

export type EnrichmentResult = {
  summary: string | null;
  credibility: string | null;
  topics: string[];
  dmcaRisk: 'low' | 'medium' | 'high' | null;
  contentWarning: boolean;
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

// Only ever returns 'medium' by way of the model's own judgment in
// enrichContent (see the `order` comparison there) — this host-only check
// used to also flag any .com whose hostname merely CONTAINS "news" or
// "media" as medium risk. That matched far more than it meant to
// (localnewsonline.com, socialmediaexample.com, a thousand small
// independent outlets) without being predictive of anything — a domain
// containing those letters says nothing about whether reacting to it draws
// a copyright strike. The explicit list below plus the model reading the
// actual content (now via web_fetch, not a guessed description) is the
// real signal; this stays a clean two-value pre-screen rather than a
// three-value one whose middle value was noise.
export function hostDMCARisk(url: string): 'low' | 'medium' | 'high' {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (HIGH_RISK_HOSTS.some((x) => h === x || h.endsWith('.' + x))) return 'high';
    return 'low';
  } catch { return 'low'; }
}

const SYSTEM_PROMPT = `You are an editorial assistant for a live political/news streamer. You read articles and videos and produce concise reaction-prep notes.

When the user turn gives you a bare article URL (rather than pasted content), use the web_fetch tool to actually read the page before writing your analysis — the OG description alone is a single marketing sentence, not the article, and is never enough to summarize or judge from. If the fetch fails or the page is paywalled, say so honestly in the summary rather than inventing content.

Output STRICT JSON only, no prose, no markdown fences. Schema:
{
  "summary": "3-5 sentence neutral summary of what the piece actually says. Focus on the news/argument, not the framing.",
  "credibility": "one of: mainstream | partisan-left | partisan-right | tabloid | trade | blog | social | unknown",
  "topics": ["3-6 short topic tags, lowercase, hyphen-separated, e.g. 'gaza', 'us-foreign-policy', 'tech-layoffs'"],
  "dmca_risk": "one of: low | medium | high  — based on whether reacting to this on a live Twitch stream could draw a copyright strike. Articles=low. News-org video=medium. Studio/label/sports/full-episode-TV=high.",
  "content_warning": "boolean — true ONLY if the content likely SHOWS graphic violence, gore, death/dead bodies, a killing, or other disturbing imagery a streamer should be warned about before putting it on screen. Ordinary political/news discussion, opinion, or text reporting about violent events is false. When unsure, false."
}

Be honest about credibility. 'partisan-left' and 'partisan-right' are not insults; they describe the outlet's editorial stance. 'mainstream' means broad-spectrum legacy outlets (Reuters, AP, NYT, BBC, Globe and Mail, etc.) regardless of perceived lean.`;

const MODEL = 'claude-sonnet-5';

export async function enrichContent(input: {
  url: string;
  title: string | null;
  publisher: string | null;
  body: string | null; // article body OR youtube description+transcript
  kind?: string | null; // media kind — 'article' switches to the web_fetch path below
  streamId?: string | null; // for usage metering
}): Promise<EnrichmentResult> {
  const client = getClient();
  const hostRisk = hostDMCARisk(input.url);

  // Articles get their content read live via the web_fetch tool: the only
  // thing extract-article.ts hands us is an OG/twitter meta description,
  // typically one marketing sentence, and asking the model to summarize or
  // judge credibility from that alone means it's mostly filling in from
  // prior knowledge of the outlet rather than the actual piece. Every other
  // kind (YouTube's transcript, TikTok's caption) already supplies real
  // content as `body`, so those keep the original text-only path.
  const isArticle = input.kind === 'article';

  if (!client || (!isArticle && !input.body)) {
    return {
      summary: null,
      credibility: null,
      topics: [],
      dmcaRisk: hostRisk,
      contentWarning: false,
    };
  }

  // web_fetch only fetches URLs already present in the conversation, so the
  // article path puts the bare URL in the user turn instead of pre-fetched
  // text. The OG description still rides along as a fallback hint — useful
  // if the fetch is blocked (paywall, bot-detection) — but is explicitly
  // marked as inferior to what the tool itself returns.
  const userText = isArticle
    ? [
        `Read and analyze this article.`,
        `URL: ${input.url}`,
        `Publisher: ${input.publisher || 'unknown'}`,
        `Title: ${input.title || 'unknown'}`,
        input.body
          ? `Page description (fallback only, may be incomplete or promotional — prefer what web_fetch actually returns): ${input.body}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    : `URL: ${input.url}
Publisher: ${input.publisher || 'unknown'}
Title: ${input.title || 'unknown'}

Content:
${input.body!.slice(0, 5500)}`;

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      ...(isArticle
        ? {
            tools: [
              {
                type: 'web_fetch_20260209' as const,
                name: 'web_fetch' as const,
                max_uses: 1,
                max_content_tokens: 8000,
              },
            ],
          }
        : {}),
      messages: [{ role: 'user', content: userText }],
    });

    // Safety classifiers can decline instead of erroring (HTTP 200,
    // stop_reason "refusal") — treat that the same as a failed call rather
    // than trying to parse content that may not be JSON.
    if (resp.stop_reason === 'refusal') {
      console.warn('enrichContent refused for', input.url);
      return { summary: null, credibility: null, topics: [], dmcaRisk: hostRisk, contentWarning: false };
    }

    // Record the AI cost as soon as the call returns — the tokens are billed
    // whether or not parsing below succeeds. usage already reflects any
    // content the web_fetch tool pulled into context.
    await recordUsage({
      streamId: input.streamId ?? null,
      kind: 'ai_enrich',
      units: 1,
      meta: {
        model: MODEL,
        input_tokens: resp.usage?.input_tokens ?? null,
        output_tokens: resp.usage?.output_tokens ?? null,
        web_fetch: isArticle,
      },
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
      contentWarning: parsed.content_warning === true,
    };
  } catch (err) {
    console.error('enrichContent failed', err);
    return { summary: null, credibility: null, topics: [], dmcaRisk: hostRisk, contentWarning: false };
  }
}
