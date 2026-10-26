import { supabaseAdmin } from './supabase';

export type ShowNote = {
  id: string;
  title: string | null;
  url: string;
  played_at: string;
  summary: string | null;
  archive_url: string | null;
  takeaway: string | null;
};

export async function readShowNotes(streamId: string, destination: 'history' | 'markdown' | 'discord'): Promise<ShowNote[]> {
  const { data, error } = await supabaseAdmin().rpc('read_show_notes', {
    p_stream_id: streamId, p_destination: destination,
  });
  if (error || !Array.isArray(data)) throw new Error('Could not load show notes.', { cause: error });
  return data as ShowNote[];
}

export async function acknowledgeShowNotes(
  streamId: string, destination: 'markdown' | 'discord', ids: string[], token?: string,
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin().rpc('acknowledge_show_notes', {
    p_stream_id: streamId, p_destination: destination, p_ids: ids, p_token: token ?? null,
  });
  if (error) throw new Error('Could not save show-note export receipts.', { cause: error });
}
