// dns.lookup is mocked throughout so these tests are deterministic and don't
// depend on real network/DNS access — the literal-IP and scheme/hostname
// checks in safe-fetch.ts run entirely synchronously against the URL and
// never reach the mock at all, which is exactly what's being pinned down for
// those cases.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('dns/promises', () => ({ default: { lookup: vi.fn() } }));

import dns from 'dns/promises';
import { safeFetchText, UnsafeUrlError } from './safe-fetch';

const PUBLIC_IP = '93.184.216.34'; // example.com
const METADATA_IP = '169.254.169.254'; // AWS/GCP instance metadata

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(dns.lookup).mockReset();
});

describe('safeFetchText — literal IPs and schemes (no DNS involved)', () => {
  it('rejects loopback', async () => {
    await expect(safeFetchText('http://127.0.0.1/secret')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects the cloud metadata link-local address', async () => {
    await expect(safeFetchText(`http://${METADATA_IP}/latest/meta-data/`)).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects RFC1918 private ranges', async () => {
    await expect(safeFetchText('http://10.0.0.5/')).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetchText('http://172.16.0.1/')).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetchText('http://192.168.1.1/')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects IPv6 loopback and unique-local addresses', async () => {
    await expect(safeFetchText('http://[::1]/')).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetchText('http://[fd00::1]/')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects "localhost" and subdomains by name before any DNS lookup', async () => {
    await expect(safeFetchText('http://localhost/')).rejects.toThrow(UnsafeUrlError);
    await expect(safeFetchText('http://foo.localhost/')).rejects.toThrow(UnsafeUrlError);
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) scheme', async () => {
    await expect(safeFetchText('file:///etc/passwd')).rejects.toThrow(UnsafeUrlError);
  });

  it('allows a public literal IP straight through, no DNS needed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('ok', { status: 200 }))));
    const result = await safeFetchText(`http://${PUBLIC_IP}/`);
    expect(result.text).toBe('ok');
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});

describe('safeFetchText — hostname resolution', () => {
  it('rejects a public-looking hostname that resolves to a private address', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: METADATA_IP, family: 4 }] as never);
    await expect(safeFetchText('http://evil.example.com/')).rejects.toThrow(UnsafeUrlError);
  });

  it('allows a hostname that resolves to a public address', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: PUBLIC_IP, family: 4 }] as never);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('hello', { status: 200 }))));
    const result = await safeFetchText('http://example.com/');
    expect(result.text).toBe('hello');
    expect(result.status).toBe(200);
  });

  it('does not treat a DNS failure as unsafe — lets fetch() itself raise the real error', async () => {
    vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))));
    await expect(safeFetchText('http://nonexistent.example.invalid/')).rejects.toThrow('ENOTFOUND');
  });
});

describe('safeFetchText — redirects', () => {
  it('follows a redirect chain, resolving and validating each hop', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: PUBLIC_IP, family: 4 }] as never);
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        calls++;
        if (String(input) === 'http://a.example.com/') {
          return Promise.resolve(
            new Response(null, { status: 302, headers: { location: 'http://b.example.com/' } }),
          );
        }
        return Promise.resolve(new Response('final', { status: 200 }));
      }),
    );
    const result = await safeFetchText('http://a.example.com/');
    expect(result.text).toBe('final');
    expect(result.url).toBe('http://b.example.com/');
    expect(calls).toBe(2);
  });

  it('refuses a redirect chain that lands on a private address', async () => {
    vi.mocked(dns.lookup).mockImplementation(async (host: string) => {
      if (host === 'a.example.com') return [{ address: PUBLIC_IP, family: 4 }] as never;
      return [{ address: METADATA_IP, family: 4 }] as never;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(null, { status: 302, headers: { location: 'http://internal.example.com/' } })),
      ),
    );
    await expect(safeFetchText('http://a.example.com/')).rejects.toThrow(UnsafeUrlError);
  });

  it('gives up after maxRedirects hops rather than following forever', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: PUBLIC_IP, family: 4 }] as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(null, { status: 302, headers: { location: 'http://a.example.com/next' } })),
      ),
    );
    await expect(safeFetchText('http://a.example.com/', { maxRedirects: 2 })).rejects.toThrow('too many redirects');
  });
});

describe('safeFetchText — size cap', () => {
  it('truncates the body at maxBytes instead of throwing', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: PUBLIC_IP, family: 4 }] as never);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('x'.repeat(1000), { status: 200 }))));
    const result = await safeFetchText('http://example.com/', { maxBytes: 100 });
    expect(result.text.length).toBe(100);
    expect(result.truncated).toBe(true);
  });

  it('does not truncate a body under the cap', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: PUBLIC_IP, family: 4 }] as never);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('short', { status: 200 }))));
    const result = await safeFetchText('http://example.com/', { maxBytes: 100 });
    expect(result.text).toBe('short');
    expect(result.truncated).toBe(false);
  });
});
