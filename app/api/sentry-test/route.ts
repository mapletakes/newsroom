// Temporary route to verify server-side Sentry reporting. Safe to delete
// once verified — see app/sentry-test/page.tsx.
export const dynamic = 'force-dynamic';

export async function GET() {
  throw new Error('Sentry server test error');
}
