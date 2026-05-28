import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { DeckView } from './DeckView';

export const dynamic = 'force-dynamic';

export default async function DeckPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <DeckView displayName={session.displayName} streamId={session.streamId} />;
}
