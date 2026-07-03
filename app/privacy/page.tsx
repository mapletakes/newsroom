import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';

export const metadata = { title: 'Privacy Policy — The Broadside' };

const CONTACT = 'mapletakestv@gmail.com';
const UPDATED = 'July 2026';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <header className="mb-8 flex items-center gap-3 flex-wrap">
        <Wordmark />
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">/ privacy</span>
        <Link href="/" className="ml-auto underline hover:text-rust font-mono text-xs uppercase tracking-widest">
          ← Home
        </Link>
      </header>

      <h1 className="font-display text-4xl font-bold mb-2">Privacy Policy</h1>
      <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-6">Last updated: {UPDATED}</p>
      <div className="rule-double mb-8" />

      <div className="leading-relaxed text-ink/80 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-ink [&_h2]:mt-10 [&_h2]:mb-3 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:mb-4 [&_li]:text-ink/80 [&_strong]:text-ink">
        <p>
          The Broadside is a tool for political and news react streamers to triage links their
          chat submits. This page explains what we collect, why, and who else sees it — in plain
          language, not boilerplate.
        </p>

        <h2>What we collect</h2>
        <p><strong>From Twitch, when you connect:</strong></p>
        <ul>
          <li>Your Twitch user ID, login, and display name.</li>
          <li>
            An OAuth access/refresh token, encrypted at rest. It&apos;s used only to read your
            channel&apos;s chat (via Twitch EventSub) and, if you click &ldquo;Post to chat,&rdquo;
            to send that one message as you. We never post, moderate, ban, or take any other
            action on your behalf.
          </li>
        </ul>
        <p><strong>From your chat, once connected:</strong></p>
        <ul>
          <li>
            Messages are scanned for URLs. When one is found, we store the link, the submitting
            username, the message text, and their sub/mod/VIP status at the time. We don&apos;t
            otherwise read, store, or process chat that doesn&apos;t contain a link.
          </li>
        </ul>
        <p><strong>From the links themselves:</strong></p>
        <ul>
          <li>
            Titles, descriptions, thumbnails, and (for video) transcripts are fetched from the
            source, and a summary, publisher-credibility tag, copyright-risk flag, and
            content-warning flag are generated using Anthropic&apos;s Claude AI.
          </li>
          <li>Related-coverage suggestions are looked up via the Brave Search API.</li>
          <li>A snapshot of the page can be captured via the Internet Archive&apos;s Wayback Machine.</li>
        </ul>
        <p><strong>Account/session:</strong></p>
        <ul>
          <li>
            A signed session cookie identifying who you are while you&apos;re signed in. We don&apos;t
            use third-party analytics, advertising, or tracking cookies of any kind.
          </li>
        </ul>

        <h2>What we don&apos;t do</h2>
        <ul>
          <li>We don&apos;t sell or share your data with advertisers.</li>
          <li>We don&apos;t run analytics or tracking scripts on this site.</li>
          <li>We don&apos;t post to your chat, moderate, or take any action on Twitch without you clicking a button to do it.</li>
        </ul>

        <h2>Who else processes it</h2>
        <p>
          Running the service means a few outside providers handle pieces of it, each only for
          what they&apos;re named for:
        </p>
        <ul>
          <li><strong>Twitch</strong> — authentication and chat access.</li>
          <li><strong>Anthropic (Claude)</strong> — AI summaries, credibility, and risk tagging.</li>
          <li><strong>Google (YouTube Data API)</strong> — video metadata.</li>
          <li><strong>Brave Search</strong> — related-coverage lookups.</li>
          <li><strong>Internet Archive</strong> — Wayback Machine snapshots.</li>
          <li><strong>Supabase</strong> — database hosting.</li>
          <li><strong>Vercel</strong> — application hosting.</li>
        </ul>

        <h2>How long we keep it</h2>
        <p>
          Submission history, settings, and connection tokens persist until you ask us to remove
          them or an admin removes your access. Signing out only ends your browser session — it
          doesn&apos;t delete anything from our database. If you want your data removed, see
          &ldquo;Contact&rdquo; below; there&apos;s no automated self-service deletion yet.
        </p>

        <h2>Stopping chat capture</h2>
        <p>
          You can narrow what gets captured any time in Settings (a submit command, an
          allow-list of subs/mods/VIPs only, ignored usernames). To stop capture entirely, revoke
          The Broadside&apos;s access under your Twitch account&apos;s connected-apps settings, or
          email us and we&apos;ll disconnect it for you.
        </p>

        <h2>Security</h2>
        <p>
          OAuth tokens are encrypted at rest (AES-256-GCM). Session cookies are HMAC-signed and
          HTTP-only. All traffic is served over HTTPS.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes materially, we&apos;ll update the date at the top of this page.
        </p>

        <h2>Contact</h2>
        <p>
          Questions, data requests, or takedown requests: <a href={`mailto:${CONTACT}`} className="underline hover:text-rust">{CONTACT}</a>.
        </p>
      </div>
    </main>
  );
}
