import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase';
import { isAdmin } from '@/lib/admin';
import { StreamTheme } from '@/components/StreamTheme';
import { AppHeader } from '@/components/AppHeader';
import { QuestionsView } from './QuestionsView';

export const dynamic = 'force-dynamic';

export default async function QuestionsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const sb = supabaseAdmin();
  const { data: stream } = await sb
    .from('streams')
    .select('approved, questions_enabled, question_command, twitch_login')
    .eq('id', session.streamId)
    .maybeSingle();

  if (stream?.approved === false) redirect('/blocked');

  // Not a redirect: a mod/streamer with a bookmarked link here after a super
  // admin turns the feature off should get an explanation, not get silently
  // bounced somewhere else and left wondering why their link changed.
  if (!stream?.questions_enabled) {
    return (
      <div className="min-h-screen flex flex-col">
        <StreamTheme />
        <AppHeader className="border-b-2 border-ink px-6 py-3 gap-6" section="questions" />
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-md text-center">
            <h1 className="font-display text-3xl font-bold mb-2">Questions isn&apos;t on for this account</h1>
            <p className="text-ink/60 leading-relaxed mb-6">
              This lets viewers submit questions for an interview or Q&amp;A segment via a chat
              command. It&apos;s enabled per account by a Broadside admin — reach out if you&apos;d
              like it turned on.
            </p>
            <Link href="/deck" className="underline hover:text-rust font-mono text-sm">
              ← Back to the deck
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <>
      <StreamTheme />
      <QuestionsView
        streamId={session.streamId}
        displayName={session.displayName}
        channel={stream.twitch_login}
        isMod={session.role === 'mod'}
        isAdmin={isAdmin(session.twitchUserId)}
        questionCommand={stream.question_command || null}
      />
    </>
  );
}
