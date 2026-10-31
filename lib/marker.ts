// "Open source" → Twitch stream marker. The description is the item's title
// (the streamer's override if they set one), so the marker reads the same in
// Twitch's VOD timeline as it did on the overlay.

import { MAX_MARKER_DESCRIPTION } from './twitch-oauth';

export function buildMarkerDescription(title: string | null, url: string): string {
  const t = (title || url).replace(/\s+/g, ' ').trim();
  return t.length > MAX_MARKER_DESCRIPTION ? t.slice(0, MAX_MARKER_DESCRIPTION - 1).trimEnd() + '…' : t;
}
