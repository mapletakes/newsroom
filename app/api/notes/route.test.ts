import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ session: vi.fn(), approved: vi.fn(), read: vi.fn(), ack: vi.fn() }));
vi.mock('@/lib/session', () => ({ getSession: mocks.session, getApprovedSession: mocks.approved }));
vi.mock('@/lib/show-notes', () => ({ readShowNotes: mocks.read, acknowledgeShowNotes: mocks.ack }));
const note = { id: 'note-1', title: 'Covered story', url: 'https://example.com/story', played_at: '2026-10-13T22:00:00Z', summary: 'Summary', archive_url: 'https://archive.example/story', takeaway: 'A takeaway' };
const request = (query = '') => new NextRequest(`http://localhost/api/notes${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ streamId: 'stream-1', displayName: 'Streamer' });
  mocks.approved.mockResolvedValue({ streamId: 'stream-1', displayName: 'Streamer' });
  mocks.read.mockResolvedValue([note]);
});

describe('show-note export', () => {
  it('previews Markdown without acknowledging anything', async () => {
    const response = await GET(request('?format=markdown'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('[Archived snapshot](https://archive.example/story)');
    expect(mocks.read).toHaveBeenCalledWith('stream-1', 'markdown');
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('acknowledges only IDs present in the exported snapshot', async () => {
    const response = await GET(request('?format=markdown&commit=1'));
    expect(response.status).toBe(200);
    expect(mocks.ack).toHaveBeenCalledWith('stream-1', 'markdown', ['note-1']);
    expect(await response.text()).toContain('Covered story');
    expect(mocks.approved).toHaveBeenCalledOnce();
  });

  it('does not advance an empty export', async () => {
    mocks.read.mockResolvedValue([]);
    expect((await GET(request('?format=markdown&commit=1'))).status).toBe(200);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('does not return a successful committed export if saving receipts fails', async () => {
    mocks.ack.mockRejectedValue(new Error('private database details'));
    const response = await GET(request('?format=markdown&commit=1'));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('could not save export receipts');
  });

  it('returns an error on a failed snapshot read rather than silently exporting an empty list', async () => {
    mocks.read.mockRejectedValue(new Error('private database details'));
    expect((await GET(request('?format=markdown&commit=1'))).status).toBe(500);
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('reads active history independently of export receipts', async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ notes: [note] });
    expect(mocks.read).toHaveBeenCalledWith('stream-1', 'history');
    expect(mocks.ack).not.toHaveBeenCalled();
  });

  it('lets a full-history download recover earlier exports without consuming new notes', async () => {
    const response = await GET(request('?format=markdown&scope=all&commit=1'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('all played items');
    expect(mocks.read).toHaveBeenCalledWith('stream-1', 'history');
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.approved).not.toHaveBeenCalled();
  });

  it('refuses a committed export for a blocked or unauthenticated session', async () => {
    mocks.approved.mockResolvedValue(null);
    expect((await GET(request('?format=markdown&commit=1'))).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
  });
});
