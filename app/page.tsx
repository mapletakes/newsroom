import Link from 'next/link';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { buttonVariants } from '@/components/ui/button';
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
            submit, fetches the article or video, tags the source&apos;s credibility, and flags
            the ones likely to draw a copyright strike or need a content warning
            <em> before</em> you hit play.
          </p>
          <p className="text-lg leading-relaxed mb-8">
            Your mods triage on one screen, sorted into named segments if you want a running
            order. You react on another, with an OBS overlay and a one-click &ldquo;Watching:&rdquo;
            chat post for whatever&apos;s live. Everything you covered becomes timestamped show
            notes the moment you go offline.
          </p>
          {session ? (
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/deck" className={buttonVariants({ size: 'lg' })}>
                Go to your deck →
              </Link>
              <Link href="/mod" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                Mod view
              </Link>
            </div>
          ) : (
            <a href="/api/twitch/oauth" className={buttonVariants({ size: 'lg' })}>
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
              Flags DMCA-risky sources and possible graphic content
            </li>
            <li className="border-l-2 border-rust pl-3">
              Mod-triage view, separate from the streamer deck
            </li>
            <li className="border-l-2 border-rust pl-3">
              On-air OBS overlay, themed to match your stream
            </li>
            <li className="border-l-2 border-rust pl-3">
              Show notes exported to Markdown or posted to Discord
            </li>
          </ul>
        </aside>
      </section>

      {/* Feature grid — everything added since launch */}
      <section className="px-6 py-16 max-w-6xl mx-auto w-full">
        <div className="flex items-baseline justify-between flex-wrap gap-3 mb-10">
          <h2 className="font-display text-3xl md:text-4xl font-bold">Every part of the run of show</h2>
          <span className="font-mono text-xs uppercase tracking-widest text-ink/50">
            Not just link triage
          </span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              t: 'Named segments',
              d: 'Group up next into named blocks — Politics, Tech, Wildcard — and drag items between them or reorder the blocks themselves.',
            },
            {
              t: 'Overlay & chat, on your terms',
              d: 'An OBS browser-source overlay for whatever’s live, themed to your stream’s own colors. Post the same link to chat and pin it with one click — and override the title shown on both if the scraped one isn’t right.',
            },
            {
              t: 'Warnings before you’re live',
              d: 'Trigger warnings you write lead the chat post and the overlay. AI- and keyword-flagged content warnings catch graphic material a mod might miss during a fast-moving queue.',
            },
            {
              t: 'The Shelf',
              d: 'A durable research list independent of tonight’s run of show. Keep prep notes, organize it into segments ahead of time, then send a whole rundown to the deck at once.',
            },
            {
              t: 'Add from anywhere',
              d: (
                <>
                  A browser extension and a bookmarklet put whatever tab you&rsquo;re reading
                  straight onto the deck or a Shelf segment — no chat message required. Get the{' '}
                  <a
                    href="https://chromewebstore.google.com/detail/the-broadside-quick-add/jnbojbaimcbpiaimiopedfcagkdnppmk"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-rust"
                  >
                    Chrome extension
                  </a>{' '}
                  (works on Edge too).
                </>
              ),
            },
            {
              t: 'Mods, scoped to what they need',
              d: 'Approve straight into a segment, not just an ungrouped pile — and see who approved what. Grant deck-organizing and on-air control separately, so a mod’s reach never has to match yours.',
            },
            {
              t: 'Audience Q&A',
              d: 'A chat command feeds a mod-triaged question queue onto the on-air overlay, so you can take questions without reading raw chat.',
            },
            {
              t: 'Chat raffles',
              d: 'Timed !enter windows, a random draw, sub/VIP-only entry, and a per-winner reroll — announced to chat automatically.',
            },
            {
              t: 'Mod availability',
              d: 'A green/yellow/red roster so you know who’s around to triage before you go live, without pinging anyone.',
            },
            {
              t: 'After the show',
              d: 'Every played item becomes a timestamped show note with your own takeaway. Export the run as Markdown, or post the played list straight to a Discord webhook.',
            },
            {
              t: 'Archive receipts',
              d: 'A snapshot of the page is captured automatically on approval — a receipt if the source edits or deletes it later.',
            },
            {
              t: 'Your app, your colors',
              d: 'Pick a built-in palette or build a custom one from your brand colors, applied across the deck, mod view, and overlay alike.',
            },
          ].map((f) => (
            <div key={f.t} className="card-paper p-5">
              <h3 className="font-display text-lg font-bold mb-2">{f.t}</h3>
              <p className="text-sm leading-relaxed text-ink/80">{f.d}</p>
            </div>
          ))}
        </div>
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
                d: 'One OAuth click grants read access to your chat, and the ability to post one “now watching” message when you click it. No moderation actions, ever.',
              },
              {
                n: '02',
                t: 'Fill the queue',
                d: 'Share the mod link with your trusted chat — they approve, tag, and organize into segments, sorted out of the firehose before you ever see it. Or skip chat entirely: add from the browser extension, or send a whole rundown over from the Shelf.',
              },
              {
                n: '03',
                t: 'React from the deck',
                d: 'One piece at a time — title, summary, source, risk. Hit Played and it’s archived and turned into a show note, ready to export or post to Discord.',
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
        <div className="font-mono text-xs uppercase tracking-widest flex flex-wrap gap-4 mt-3 text-ink/50">
          <Link href="/privacy" className="underline hover:text-rust">Privacy</Link>
          <Link href="/terms" className="underline hover:text-rust">Terms</Link>
        </div>
      </footer>
    </main>
  );
}
