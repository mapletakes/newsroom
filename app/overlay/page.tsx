import { OverlayView } from './OverlayView';

export const metadata = { title: 'Overlay — The Broadside' };
export const dynamic = 'force-dynamic';

const THEMES = ['light', 'dark', 'sepia', 'contrast'] as const;
export type OverlayTheme = (typeof THEMES)[number];

// OBS browser-source lower third. Add in OBS as a Browser Source pointed at
// /overlay?token=<add token>[&theme=light|dark|sepia|contrast][&brand=0],
// sized around 800×100. Renders nothing (fully transparent) when the deck
// has no item on air. With no theme param, it follows the browser's system
// preference — OBS's embedded browser typically resolves that to light.
// brand=0 hides the small "The Broadside" mark on the card (shown by default).
export default function OverlayPage({
  searchParams,
}: {
  searchParams: { token?: string; theme?: string; brand?: string };
}) {
  const theme = (THEMES as readonly string[]).includes(searchParams.theme || '')
    ? (searchParams.theme as OverlayTheme)
    : null;
  const showBrand = searchParams.brand !== '0';
  return (
    <>
      {/* The app shell paints the paper background; a browser source needs
          transparency so only the lower-third card shows over the stream. */}
      <style>{'html, body { background: transparent !important; }'}</style>
      <OverlayView token={searchParams.token || ''} theme={theme} showBrand={showBrand} />
    </>
  );
}
