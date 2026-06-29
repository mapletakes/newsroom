// Heuristic scan for graphic/disturbing-content signals in a title or
// description. Deterministic and free — runs on every submission. Paired with
// an AI flag (see enrich.ts) for content that doesn't self-label. Returns a
// short human reason when something matches, or null.
//
// Tuned toward explicit warnings and strong gore/violence terms so ordinary
// political/news coverage (war, shooting, death as topics) doesn't trip it.
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bviewer discretion\b/i, label: 'viewer discretion advised' },
  { re: /\b(content|trigger)\s+warning\b/i, label: 'content/trigger warning' },
  { re: /\bwarning[:\s\-–—]+\s*graphic\b/i, label: 'graphic warning' },
  { re: /\bgraphic (content|footage|video|images?|photos?|violence)\b/i, label: 'graphic content' },
  { re: /\b(disturbing|distressing) (content|footage|video|images?|scenes?)\b/i, label: 'disturbing footage' },
  { re: /\bnsf[wl]\b/i, label: 'NSFW' },
  { re: /\b(gore|gory)\b/i, label: 'gore' },
  { re: /\b(beheading|decapitat\w*)\b/i, label: 'beheading' },
  { re: /\bmutilat\w*\b/i, label: 'mutilation' },
  { re: /\bexecution (video|footage)\b/i, label: 'execution footage' },
  { re: /\bdead (body|bodies)\b/i, label: 'dead bodies' },
];

/**
 * Scan one or more text fields (title, description, …) for content-warning
 * signals. Returns a short reason like `Mentions "graphic content"` for the
 * first match, or null if nothing matches.
 */
export function scanContentWarning(...texts: (string | null | undefined)[]): string | null {
  const hay = texts.filter(Boolean).join('  ');
  if (!hay) return null;
  for (const { re, label } of PATTERNS) {
    if (re.test(hay)) return `Mentions ${label}`;
  }
  return null;
}
