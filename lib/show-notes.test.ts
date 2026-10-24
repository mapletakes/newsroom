import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeShowNotes, readShowNotes } from './show-notes';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabaseAdmin: () => ({ rpc }) }));
beforeEach(() => vi.resetAllMocks());

describe('show-note snapshot and receipt boundary', () => {
  it('reads the complete scalar snapshot without applying a client row limit', async () => {
    const notes = Array.from({ length: 1001 }, (_, id) => ({ id: String(id) }));
    rpc.mockResolvedValue({ data: notes, error: null });
    expect(await readShowNotes('stream-1', 'markdown')).toHaveLength(1001);
    expect(rpc).toHaveBeenCalledWith('read_show_notes', { p_stream_id: 'stream-1', p_destination: 'markdown' });
  });

  it.each([{ data: null, error: null }, { data: [], error: { message: 'database unavailable' } }])('rejects failed or malformed snapshot results', async (result) => {
    rpc.mockResolvedValue(result);
    await expect(readShowNotes('stream-1', 'history')).rejects.toThrow('Could not load show notes.');
  });

  it('acknowledges exactly the supplied IDs under the export lease', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    await acknowledgeShowNotes('stream-1', 'discord', ['note-1', 'note-2'], 'lease-1');
    expect(rpc).toHaveBeenCalledWith('acknowledge_show_notes', {
      p_stream_id: 'stream-1', p_destination: 'discord', p_ids: ['note-1', 'note-2'], p_token: 'lease-1',
    });
  });

  it('does not write for an empty export', async () => {
    await acknowledgeShowNotes('stream-1', 'markdown', []);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces a receipt failure instead of reporting export success', async () => {
    rpc.mockResolvedValue({ error: { message: 'database unavailable' } });
    await expect(acknowledgeShowNotes('stream-1', 'markdown', ['note-1'])).rejects.toThrow('Could not save show-note export receipts.');
  });
});
