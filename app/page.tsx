import Link from 'next/link';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { getSession } from '@/lib/session';

// Reads the session cookie to tailor the CTA, so render per-request.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getSession();
  return (
    <main className="min-h-screen flex flex-col">
      {/* Masthead */}
      <header className="border-b-4 border-double border-ink px-6 pt-8 pb-4 max-w-6xl mx-auto w-full">
        <div className="flex items-baseline justify-between flex-wrap gap-4">
          <div className="font-mono text-xs uppercase tracking-widest">
            Vol. I · No. 1 · est. 2026
          </div>
          <div className="font-mono text-xs uppercase tracking-widest flex items-center gap-3">
            For streamers, by streamers
            <DarkModeToggle />
          </div>
        </div>
        <h1 className="font-display text-6xl md:text-8xl font-black tracking-tight leading-none text-center my-4">
          The Broadside
        </h1>
        <div className="text-center font-mono text-xs uppercase tracking-widest">
          A deck for political &amp; news react streamers
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-12 max-w-6xl mx-auto w-full grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2">
          <h2 className="font-display text-3xl md:text-4xl font-bold leading-tight mb-4">
            Your chat drops a hundred links an hour.
            <br />
            <span className="text-rust">Which one is worth reacting to?</span>
          </h2>
          <p className="text-lg leading-relaxed mb-6">
            The Broadside listens to your Twitch chat, pulls every link your mods or subs
            submit, fetches the article or video, tags
            the source&apos;s credibility, and flags the ones likely to draw a copyright strike
            <em> before</em> you hit play.
          </p>
          <p className="text-lg leading-relaxed mb-8">
            Your mods triage on one screen. You react on another. Everything you covered
            becomes timestamped show notes you can post to Substack or Discord the moment
            you go offline.
          </p>
          {session ? (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/deck"
                className="inline-block bg-ink text-paper px-8 py-4 font-mono text-sm uppercase tracking-widest hover:bg-rust transition-colors"
              >
                Go to your deck →
              </Link>
              <Link
                href="/mod"
                className="inline-block border-2 border-ink px-8 py-4 font-mono text-sm uppercase tracking-widest hover:bg-ink hover:text-paper transition-colors"
              >
                Mod view
              </Link>
            </div>
          ) : (
            <a
              href="/api/twitch/oauth"
              className="inline-block bg-ink text-paper px-8 py-4 font-mono text-sm uppercase tracking-widest hover:bg-rust transition-colors"
            >
              Connect Twitch →
            </a>
          )}
        </div>

        <aside className="border-l-2 border-ink pl-6 hidden md:block">
          <div className="rule-double mb-4" />
          <h3 className="font-display text-xl font-bold mb-3">What it does</h3>
          <ul className="space-y-3 font-mono text-sm">
            <li className="border-l-2 border-rust pl-3">
              Harvests every URL from chat in real time
            </li>
            <li className="border-l-2 border-rust pl-3">
              Tags publisher credibility &amp; political lean
            </li>
            <li className="border-l-2 border-rust pl-3">
              Flags DMCA-risky sources before you play
            </li>
            <li className="border-l-2 border-rust pl-3">
              Mod-triage view separate from streamer deck
            </li>
            <li className="border-l-2 border-rust pl-3">
              Exports show notes as Markdown
            </li>
          </ul>
        </aside>
      </section>

      {/* How it works */}
      <section className="bg-ink text-paper px-6 py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-display text-4xl font-bold mb-12 text-center">How it works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                n: '01',
                t: 'Connect Twitch',
                d: 'One OAuth click. We use chat:read only — no posting, no moderation actions from us.',
              },
              {
                n: '02',
                t: 'Open the mod view',
                d: 'Share the mod link with your trusted chat. They approve, tag, reorder. You never see the firehose.',
              },
              {
                n: '03',
                t: 'React from the deck',
                d: 'The deck shows one piece at a time. Title, summary, source, risk. Hit Played and it goes to show notes.',
              },
            ].map((step) => (
              <div key={step.n}>
                <div className="font-mono text-ochre text-sm mb-2">{step.n}</div>
                <h3 className="font-display text-2xl font-bold mb-3">{step.t}</h3>
                <p className="text-paper/80 leading-relaxed">{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-2 border-ink px-6 py-6 max-w-6xl mx-auto w-full">
        <div className="font-mono text-xs uppercase tracking-widest flex flex-wrap justify-between gap-4">
          <span>Built for the long-form political web</span>
          <span>Not legal advice · DMCA tags are heuristics</span>
        </div>
      </footer>
    </main>
  );
}
