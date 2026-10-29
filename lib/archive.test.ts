import { describe, expect, it } from 'vitest';
import { archiveSlugFromUrl } from './archive';

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
