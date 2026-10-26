import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPlayedBatches, getPendingPlayedNotes, postPlayedList } from './discord';
import type { ShowNote } from './show-notes';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), stream: vi.fn(), read: vi.fn(), ack: vi.fn(), release: vi.fn() }));
vi.mock('./show-notes', () => ({ readShowNotes: mocks.read, acknowledgeShowNotes: mocks.ack }));
vi.mock('./crypto', () => ({ decryptSecret: (value: string) => value }));
const releaseFilters: Record<string, unknown> = {};
vi.mock('./supabase', () => ({ supabaseAdmin: () => ({
  rpc: mocks.rpc,
  from: () => {
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { releaseFilters[key] = value; return chain; },
      maybeSingle: mocks.stream,
      update: mocks.release.mockImplementation(() => chain),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  },
}) }));
const webhook = 'https://discord.com/api/webhooks/123456789012345678/fixture-token';
const makeNote = (id: string, title = id): ShowNote => ({ id, title, url: `https://example.com/${id}`, played_at: '2026-10-13T22:00:00Z', takeaway: null, summary: null, archive_url: null });
let inventory: ShowNote[];
let receipts: Set<string>;
let leased: boolean;

beforeEach(() => {
  vi.resetAllMocks();
  inventory = [makeNote('note-1'), makeNote('note-2')];
  receipts = new Set(); leased = false;
  for (const key of Object.keys(releaseFilters)) delete releaseFilters[key];
  mocks.rpc.mockImplementation(async () => {
    if (leased) return { data: false, error: null };
    leased = true;
    return { data: true, error: null };
  });
  mocks.stream.mockResolvedValue({ data: { display_name: 'Streamer', discord_webhook_url: webhook }, error: null });
  mocks.read.mockImplementation(async () => inventory.filter((note) => !receipts.has(note.id)));
  mocks.ack.mockImplementation(async (_stream: string, _destination: string, ids: string[]) => { ids.forEach((id) => receipts.add(id)); });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Discord export receipts', () => {
  it('keeps each message paired with exactly the notes it contains', () => {
    const notes = [makeNote('note-1', 'a'.repeat(1800)), makeNote('note-2', 'b'.repeat(1800))];
    const batches = buildPlayedBatches('Streamer', notes);
    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.noteIds)).toEqual([['note-1'], ['note-2']]);
    expect(batches.every((batch) => batch.content.length <= 2000)).toBe(true);
  });

  it('does not acknowledge a preview', async () => {
    expect((await getPendingPlayedNotes('stream-1'))?.notes).toHaveLength(2);
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('acknowledges only the sent snapshot when another play arrives during delivery', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      inventory.push(makeNote('late-note'));
      return new Response(null, { status: 204 });
    });
    expect(await postPlayedList('stream-1')).toEqual({ ok: true, count: 2 });
    expect(mocks.ack).toHaveBeenCalledWith('stream-1', 'discord', ['note-1', 'note-2'], expect.any(String));
    expect((await getPendingPlayedNotes('stream-1'))?.notes.map((note) => note.id)).toEqual(['late-note']);
    expect(mocks.release).toHaveBeenCalledWith({ discord_export_token: null, discord_export_started_at: null });
    expect(releaseFilters.discord_export_token).toEqual(expect.any(String));
  });

  it('retains receipts for successful chunks when a later chunk fails', async () => {
    inventory = [makeNote('note-1', 'a'.repeat(1800)), makeNote('note-2', 'b'.repeat(1800))];
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await postPlayedList('stream-1')).toMatchObject({ ok: false });
    expect([...receipts]).toEqual(['note-1']);
    // The real fenced release allows the next send; emulate it here.
    leased = false;
    expect(await postPlayedList('stream-1')).toEqual({ ok: true, count: 1 });
    expect([...receipts]).toEqual(['note-1', 'note-2']);
    const retryBody = JSON.parse(String(vi.mocked(fetch).mock.calls[2][1]?.body));
    expect(retryBody.content).not.toContain('https://example.com/note-1');
    expect(retryBody.content).toContain('https://example.com/note-2');
  });

  it('refuses a competing send while a channel export owns the lease', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = postPlayedList('stream-1');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(await postPlayedList('stream-1')).toEqual({ ok: false, error: 'export-in-progress' });
    expect(fetch).toHaveBeenCalledOnce();
    finish(new Response(null, { status: 204 }));
    expect(await first).toMatchObject({ ok: true });
  });

  it('reports uncertain delivery when Discord accepts a message but saving its receipt fails', async () => {
    mocks.ack.mockRejectedValue(new Error('receipt database unavailable'));
    const result = await postPlayedList('stream-1');
    expect(result).toEqual({ ok: false, error: 'Discord accepted the message, but its receipt could not be saved. Retrying may duplicate it.' });
    expect(receipts.size).toBe(0);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not send or acknowledge after a failed snapshot read', async () => {
    mocks.read.mockRejectedValue(new Error('database unavailable'));
    expect(await postPlayedList('stream-1')).toEqual({ ok: false, error: 'could not load export notes' });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('does not save receipts when a network error leaves delivery unconfirmed', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection dropped'));
    expect(await postPlayedList('stream-1')).toEqual({ ok: false, error: 'could not confirm Discord delivery — retry may duplicate the message' });
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('stops before posting if loading the export exceeded its runtime budget', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValue(46_001);
    expect(await postPlayedList('stream-1')).toEqual({ ok: false, error: 'export timed out — retry to post the remaining notes' });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });
});
