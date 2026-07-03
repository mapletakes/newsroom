import Link from 'next/link';
import { Wordmark } from '@/components/ui/wordmark';

export const metadata = { title: 'Terms of Service — The Broadside' };

const CONTACT = 'mapletakestv@gmail.com';
const UPDATED = 'July 2026';

export default function TermsPage() {
  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <header className="mb-8 flex items-center gap-3 flex-wrap">
        <Wordmark />
        <span className="font-mono text-xs uppercase tracking-widest text-ink/60">/ terms</span>
        <Link href="/" className="ml-auto underline hover:text-rust font-mono text-xs uppercase tracking-widest">
          ← Home
        </Link>
      </header>

      <h1 className="font-display text-4xl font-bold mb-2">Terms of Service</h1>
      <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-6">Last updated: {UPDATED}</p>
      <div className="rule-double mb-8" />

      <div className="leading-relaxed text-ink/80 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-ink [&_h2]:mt-10 [&_h2]:mb-3 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:mb-4 [&_li]:text-ink/80 [&_strong]:text-ink">
        <p>
          By connecting your Twitch account to The Broadside, you agree to these terms. If you
          don&apos;t agree, don&apos;t use it — nothing here is negotiable one-on-one, but if
          something seems unreasonable, tell us at the contact below.
        </p>

        <h2>What this is</h2>
        <p>
          The Broadside reads your Twitch chat for links, lets you and your moderators triage
          them, and surfaces one at a time on a &ldquo;deck&rdquo; for you to react to. See our{' '}
          <Link href="/privacy" className="underline hover:text-rust">Privacy Policy</Link> for
          what data that involves.
        </p>

        <h2>Not affiliated with Twitch</h2>
        <p>
          The Broadside is an independent, third-party tool. It is not operated, endorsed, or
          sponsored by Twitch Interactive, Inc. Your use of Twitch itself is governed by
          Twitch&apos;s own Terms of Service, separately from this agreement.
        </p>

        <h2>Access</h2>
        <p>
          New accounts may be subject to manual approval before use. We may pause or revoke a
          channel&apos;s access at any time — most commonly for abuse, but also for technical or
          operational reasons. We&apos;ll try to tell you why if we can.
        </p>

        <h2>Your responsibilities</h2>
        <ul>
          <li>You&apos;re responsible for what your moderators approve and what you choose to play or react to on stream.</li>
          <li>Don&apos;t use the service to harvest, spam, or attack Twitch, its users, or any linked third-party site.</li>
          <li>Don&apos;t submit or knowingly approve links to illegal content.</li>
          <li>You&apos;re responsible for complying with Twitch&apos;s rules and any applicable copyright law when you react to content on stream — see the disclaimer below.</li>
        </ul>

        <h2>AI-generated content is a heuristic, not advice</h2>
        <p>
          Summaries, publisher-credibility tags, copyright-risk flags, and content warnings are
          generated automatically and can be wrong, incomplete, or miss things entirely.
          They&apos;re a starting point for your own judgment, not legal, editorial, or moderation
          advice. In particular: <strong>copyright-risk tags are heuristics, not legal advice</strong> —
          whether reacting to a specific clip is fair use or draws a takedown is a judgment call
          only you can make.
        </p>

        <h2>Ownership</h2>
        <p>
          Links, articles, and videos submitted through the service remain the property of their
          original publishers or creators. We don&apos;t claim ownership over anything submitted,
          summarized, or archived — we&apos;re just organizing pointers to it for you.
        </p>

        <h2>No warranty</h2>
        <p>
          This is provided &ldquo;as is,&rdquo; without warranty of any kind. We don&apos;t
          guarantee uptime, that chat capture never misses a message, or that AI-generated tags
          are accurate. Don&apos;t build a workflow around it that can&apos;t tolerate it being
          wrong or briefly unavailable.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, we aren&apos;t liable for any indirect,
          incidental, or consequential damages arising from your use of the service — including a
          copyright strike, chat outage, or lost show notes.
        </p>

        <h2>Termination</h2>
        <p>
          You can stop using the service any time by disconnecting your Twitch account. We may
          suspend or terminate access for any account that violates these terms.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms as the service changes. Continued use after an update means
          you accept the revised terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT}`} className="underline hover:text-rust">{CONTACT}</a>.
        </p>
      </div>
    </main>
  );
}
