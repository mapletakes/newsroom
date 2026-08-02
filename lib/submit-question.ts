// Chat-sourced audience questions — the !question-style command's ingestion
// path. Deliberately its own file rather than a branch inside submit-url.ts:
// a question is free text, not a URL, so none of that file's machinery
// (normalization, dedup by normalized_url, kind detection, DMCA/extraction)
// applies, and the two are conceptually different enough that sharing a file
// would just mean a lot of "not applicable here" branches.

import { supabaseAdmin } from './supabase';
import { broadcastQuestionsChange } from './realtime';

// A chat message is already capped at 500 chars by Twitch; this is a second,
// tighter cap so a card-sized UI (the mod queue, the streamer's deck panel)
// never has to reflow around an essay. Truncated rather than rejected — a
// slightly-too-long genuine question is still worth surfacing.
export const MAX_QUESTION_CHARS = 300;

/** Trim, collapse any embedded whitespace/newlines to single spaces (chat
 *  messages are conceptually one line; this is defense against a client that
 *  smuggles one through), and cap length. Returns '' for input with nothing
 *  left after cleanup. */
export function sanitizeQuestionText(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_QUESTION_CHARS) return collapsed;
  return collapsed.slice(0, MAX_QUESTION_CHARS - 1).trimEnd() + '…';
}

/**
 * If `messageText` starts with the stream's configured question command,
 * returns the sanitized question text after it — or null if the message
 * doesn't match, the command is unset (follows video_command's convention:
 * blank disables it), or nothing but the command itself was typed.
 *
 * Case-insensitive prefix match, same rule submit_command already uses for
 * link submission — kept as a pure function (rather than inlined in the
 * EventSub route, where submit_command's version lives) so the matching
 * logic is unit-testable without a request/response cycle.
 */
export function matchQuestionCommand(messageText: string, command: string | null | undefined): string | null {
  if (!command) return null;
  const cmd = command.toLowerCase();
  if (!messageText.toLowerCase().startsWith(cmd)) return null;
  const text = sanitizeQuestionText(messageText.slice(command.length));
  return text || null;
}

export type SubmitQuestionParams = {
  streamId: string;
  text: string;
  asker: string;
  isSub?: boolean;
  isMod?: boolean;
  isVip?: boolean;
};

/**
 * Insert a chat question as 'pending' — it does not reach the streamer until
 * a mod approves it (see the questions_enabled doc comment in schema.sql for
 * why that's the default rather than opt-out). `position` is a simple
 * insert-order counter, not a dense repack like the deck's — the only
 * reordering this ever needs is "bump to top", which the API route handles
 * by setting position below the current minimum.
 */
export async function submitQuestionToQueue(params: SubmitQuestionParams): Promise<{ question: Record<string, unknown> | null }> {
  const { streamId, text, asker, isSub = false, isMod = false, isVip = false } = params;
  const sb = supabaseAdmin();

  const { data: last } = await sb
    .from('questions')
    .select('position')
    .eq('stream_id', streamId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await sb
    .from('questions')
    .insert({
      stream_id: streamId,
      text,
      asker_login: asker,
      asker_is_sub: isSub,
      asker_is_mod: isMod,
      asker_is_vip: isVip,
      status: 'pending',
      position: (last?.position ?? 0) + 1,
    })
    .select()
    .single();

  if (error) return { question: null };
  broadcastQuestionsChange(streamId);
  return { question: data };
}
