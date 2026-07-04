import { OverlayView } from './OverlayView';

export const metadata = { title: 'Overlay — The Broadside' };
export const dynamic = 'force-dynamic';

// OBS browser-source lower third. Add in OBS as a Browser Source pointed at
// /overlay?token=<add token>, sized around 800×100. Renders nothing (fully
// transparent) when the deck has no item on air.
export default function OverlayPage({ searchParams }: { searchParams: { token?: string } }) {
  return (
    <>
      {/* The app shell paints the paper background; a browser source needs
          transparency so only the lower-third card shows over the stream. */}
      <style>{'html, body { background: transparent !important; }'}</style>
      <OverlayView token={searchParams.token || ''} />
    </>
  );
}
