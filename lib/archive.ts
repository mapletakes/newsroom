// Page archiving. Snapshots are made in-house (createArchive below, using
// lib/archive-freeze.ts) and served publicly from /a/<id>. archive.today is
// kept only as the fallback when our own capture fails — a bot-blocked site,
// a timeout, a non-HTML link.
//
// archive.today caveat: it is behind Cloudflare and often blocks datacenter IPs
// (e.g. Vercel), so a server-side capture isn't guaranteed. We therefore store
// the deterministic "newest" link — https://archive.today/newest/<url> — which
// redirects to the latest snapshot, or offers to create one when first opened
// in a real browser. We also attempt a best-effort capture so a snapshot often
// exists already by the time anyone clicks.

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { freezePage } from './archive-freeze';

const BASE = 'https://archive.today';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const SNAPSHOT_RE = /archive\.(?:today|ph|is|li|md|fo|vn)\/[A-Za-z0-9]+/;

// A link that always resolves: to the latest snapshot if one exists, otherwise
// to archive.today's save prompt for this URL.
export function newestLink(url: string): string {
  return `${BASE}/newest/${url}`;
}

export async function requestArchive(url: string): Promise<string | null> {
  // Best-effort server-side capture (may be Cloudflare-blocked).
  try {
    const res = await fetch(`${BASE}/submit/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
      },
      body: new URLSearchParams({ url, anyway: '1' }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    });

    // A fresh/existing snapshot comes back via the Refresh or Location header.
    const refresh = res.headers.get('refresh');
    const fromRefresh = refresh && /url=(\S+)/i.exec(refresh)?.[1];
    const candidate = fromRefresh || res.headers.get('location') || '';
    if (SNAPSHOT_RE.test(candidate)) {
      return candidate.replace(/^http:/, 'https:');
    }
  } catch {
    /* Cloudflare / timeout — fall back to the deterministic link */
  }

  return newestLink(url);
}

// --- In-house snapshots -----------------------------------------------------

export const ARCHIVE_BUCKET = 'archives';

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Short, unguessable-enough public id. Not a secret — snapshots are public —
// just short enough to paste into chat, and random so ids can't be walked.
export function archiveSlug(length = 10): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join('');
}

export const ARCHIVE_SLUG_RE = /^[A-Za-z0-9]{6,20}$/;

/** Freezes `url`, stores it, and returns the public /a/<id> link — or, if
 *  our own capture fails, the archive.today link as before. Never throws. */
export async function createArchive(input: {
  sb: SupabaseClient;
  url: string;
  submissionId: string | null;
  streamId: string | null;
  appUrl: string;
}): Promise<string | null> {
  const { sb, url } = input;
  try {
    const frozen = await freezePage(url);
    const id = archiveSlug();
    const path = `${id}.html`;
    const { error: upErr } = await sb.storage
      .from(ARCHIVE_BUCKET)
      .upload(path, Buffer.from(frozen.html, 'utf8'), { contentType: 'text/html; charset=utf-8', upsert: false });
    if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);
    const { error: rowErr } = await sb.from('archives').insert({
      id,
      submission_id: input.submissionId,
      stream_id: input.streamId,
      url,
      final_url: frozen.finalUrl,
      title: frozen.title,
      method: 'server',
      storage_path: path,
      bytes: frozen.bytes,
    });
    if (rowErr) {
      await sb.storage.from(ARCHIVE_BUCKET).remove([path]);
      throw new Error(`archives insert failed: ${rowErr.message}`);
    }
    return `${input.appUrl.replace(/\/+$/, '')}/a/${id}`;
  } catch (err) {
    console.warn(`createArchive: in-house capture of ${url} failed, falling back to archive.today:`, (err as Error).message);
    return requestArchive(url);
  }
}
