import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./archive-freeze', () => {
  class SiteRefusedError extends Error {
    constructor(
      public status: number,
      public freeCopyPossible: boolean,
    ) {
      super('refused');
    }
  }
  return { SiteRefusedError, freezePage: vi.fn() };
});

import { archiveSlugFromUrl, createArchive } from './archive';
import { freezePage, SiteRefusedError } from './archive-freeze';

describe('archiveSlugFromUrl', () => {
  it('reads the slug from one of our /a/<id> links on any origin', () => {
    expect(archiveSlugFromUrl('https://thebroadside.net/a/Ab3dEf7hJk')).toBe('Ab3dEf7hJk');
    expect(archiveSlugFromUrl('https://newsroom-psi-five.vercel.app/a/Ab3dEf7hJk/')).toBe('Ab3dEf7hJk');
  });

  it('ignores archive.today and anything that is not a snapshot link', () => {
    expect(archiveSlugFromUrl('https://archive.today/newest/https://example.com/')).toBeNull();
    expect(archiveSlugFromUrl('https://archive.ph/Ab3dE')).toBeNull();
    expect(archiveSlugFromUrl('https://thebroadside.net/a/../setup')).toBeNull();
    expect(archiveSlugFromUrl('not a url')).toBeNull();
  });
});

describe('createArchive — sites that refuse us', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const run = (freeCopyPossible: boolean) => {
    vi.mocked(freezePage).mockRejectedValueOnce(new SiteRefusedError(403, freeCopyPossible));
    // archive.today's best-effort submit, and any Wayback save request.
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const background = vi.fn();
    const outcome = createArchive({
      sb: {} as SupabaseClient,
      url: 'https://apnews.com/article/x',
      submissionId: 's',
      streamId: 't',
      appUrl: 'https://thebroadside.net',
      background,
    });
    return { outcome, background };
  };

  it('reports the refusal and falls back to an archive.today link', async () => {
    const { outcome, background } = run(true);
    expect(await outcome).toEqual({
      url: 'https://archive.today/newest/https://apnews.com/article/x',
      refused: true,
      waybackRequested: false,
    });
    expect(background).not.toHaveBeenCalled();
  });

  it('asks the Wayback Machine to save a free page only when ARCHIVE_WAYBACK_SAVE=1', async () => {
    vi.stubEnv('ARCHIVE_WAYBACK_SAVE', '1');
    const { outcome, background } = run(true);
    expect((await outcome).waybackRequested).toBe(true);
    expect(background).toHaveBeenCalledOnce();
  });

  it('never asks for subscription publishers or walled copies', async () => {
    vi.stubEnv('ARCHIVE_WAYBACK_SAVE', '1');
    const { outcome, background } = run(false);
    expect((await outcome).waybackRequested).toBe(false);
    expect(background).not.toHaveBeenCalled();
  });
});
