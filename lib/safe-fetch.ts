// Shared outbound-fetch guard for URLs that come from chat submissions or
// other viewer input (extract-article.ts, extract-tiktok.ts, and the
// YouTube page-scrape fallbacks) — anywhere this app fetches a URL it
// didn't choose itself. Two independent protections, both defense-in-depth
// rather than a promise of airtight isolation:
//
//  - SSRF: the target host — and every redirect hop, since fetch()'s own
//    automatic redirect handling can't be inspected mid-chain — is resolved
//    via DNS and rejected if any resolved address is private, loopback,
//    link-local (which covers cloud metadata endpoints like
//    169.254.169.254), or otherwise non-public. A submitted link that
//    points at localhost or an internal service is refused before fetch()
//    ever opens the connection, not just filtered by hostname string
//    matching (which a public-looking host that resolves privately would
//    slip past).
//  - Response size: capped while the body is being read, not from a
//    (spoofable, sometimes absent) Content-Length header, so a server that
//    lies about its length — or just keeps streaming — can't exhaust
//    function memory. Over the cap, the read stops and whatever was
//    collected so far is returned rather than the whole request failing —
//    a truncated page still has its <head> meta tags, which is all these
//    extractors actually read.

import dns from 'dns/promises';
import net from 'net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

// IPv4 ranges that are never a legitimate extraction target: loopback,
// RFC1918 private space, link-local (incl. cloud metadata), CGNAT, and a
// couple of reserved/special-purpose blocks. Not an exhaustive IANA special
// registry — the point is to catch the realistic cases (someone submits
// "http://localhost/…" or "http://169.254.169.254/…"), not every obscure
// reserved block.
const PRIVATE_V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return PRIVATE_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local, fc00::/7
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 address — check the embedded v4 address.
    const v4 = lower.split(':').pop()!;
    return net.isIPv4(v4) ? isPrivateV4(v4) : true;
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (net.isIPv6(ip)) return isPrivateV6(ip);
  return true; // unrecognized shape — fail closed
}

// dns.lookup() has no built-in timeout and no AbortSignal support in Node's
// promises API — an environment with no DNS egress at all (a sandboxed test
// runner, a locked-down network) would otherwise hang on the OS resolver's
// own timeout, which can run well past what any caller here is willing to
// wait. Racing it against a short local timeout bounds the worst case
// without changing behavior when DNS actually works.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dns lookup timed out')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Resolves `hostname` and throws UnsafeUrlError if it — or any address it
 *  resolves to — is private/reserved. A DNS failure (including our own
 *  timeout above) is NOT treated as unsafe: that's a normal "domain doesn't
 *  exist" case, and fetch() itself will raise the clearer network error a
 *  moment later. */
async function assertPublicHost(hostname: string): Promise<void> {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) {
    throw new UnsafeUrlError(`refusing to fetch local host "${hostname}"`);
  }
  // URL.hostname serializes an IPv6 literal WITH its brackets (e.g. "[::1]",
  // vs. "::1" for the bare address) — net.isIP() and dns.lookup() both
  // expect the bare form, and a bracketed string matches neither, silently
  // falling through as if it were an ordinary hostname. Strip them before
  // every check below so an IPv6 literal is actually recognized as one.
  const bareHost = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
  if (net.isIP(bareHost)) {
    if (isPrivateIp(bareHost)) throw new UnsafeUrlError(`refusing to fetch private address "${hostname}"`);
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await withTimeout(dns.lookup(bareHost, { all: true }), 3000);
  } catch {
    return;
  }
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new UnsafeUrlError(`refusing to fetch "${hostname}" — resolves to a private address`);
  }
}

export type SafeFetchOptions = {
  headers?: Record<string, string>;
  maxBytes?: number; // default 5 MB
  maxRedirects?: number; // default 5
  timeoutMs?: number; // default 10000
};

export type SafeFetchResult = {
  url: string; // final URL after following redirects
  status: number;
  text: string;
  truncated: boolean; // true if the body was cut off at maxBytes
};

/**
 * fetch() for a URL that ultimately came from user/chat input. Validates the
 * target — and every redirect hop, followed manually so each one can be
 * checked — isn't a private address, and caps how much of the body is read
 * into memory.
 *
 * Throws UnsafeUrlError for a scheme other than http/https or a private
 * target; callers that already wrap extraction in a try/catch (every
 * extractor here does, one level up in lib/extract.ts) get that for free as
 * an extraction failure rather than needing their own handling.
 */
export async function safeFetchText(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  let current = url;

  for (let hop = 0; ; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new UnsafeUrlError(`invalid URL "${current}"`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new UnsafeUrlError(`unsupported scheme "${parsed.protocol}"`);
    }
    await assertPublicHost(parsed.hostname);

    const res = await fetch(parsed.toString(), {
      headers: options.headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { url: parsed.toString(), status: res.status, text: '', truncated: false };
      if (hop >= maxRedirects) throw new UnsafeUrlError('too many redirects');
      current = new URL(location, parsed).toString();
      continue;
    }

    const { text, truncated } = await readTextLimited(res, maxBytes);
    return { url: parsed.toString(), status: res.status, text, truncated };
  }
}

async function readTextLimited(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      const remaining = maxBytes - total;
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    total += value.byteLength;
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), truncated };
}
