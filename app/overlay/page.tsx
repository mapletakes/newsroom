import { OverlayView, type OverlayVariant } from './OverlayView';

export const metadata = { title: 'Overlay — The Broadside' };
export const dynamic = 'force-dynamic';

const THEMES = ['light', 'dark', 'sepia', 'contrast'] as const;
export type OverlayTheme = (typeof THEMES)[number];

const VARIANTS = ['default', 'minimal', 'ticker'] as const;

// OBS browser-source lower third. Add in OBS as a Browser Source pointed at
// /overlay?token=<add token>[&theme=light|dark|sepia|contrast][&brand=0][&variant=default|minimal|ticker],
// sized around 800×100 (default/minimal) or 800×120 (ticker) — a trigger
// warning fits inside those same heights: default/ticker don't change size at
// all, and minimal grows ~20px but still fits. Renders nothing
// (fully transparent) when the deck has no item on air. With no theme param,
// it follows the browser's system preference — OBS's embedded browser
// typically resolves that to light. brand=0 hides the small "The Broadside"
// mark on the card (shown by default). variant picks the layout: default is
// the full title+meta lower third, minimal is a single-line title-only chip,
// and ticker adds a slim "up next" line under the default card.
export default async function OverlayPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; theme?: string; brand?: string; variant?: string }>;
}) {
  const sp = await searchParams;
  // Legacy: colours now live on the stream row and reach the source through
  // the poll, so this only applies to a browser source added before that
  // existed and never reconfigured. Once a theme is saved in Settings it wins.
  const fallbackPreset = (THEMES as readonly string[]).includes(sp.theme || '')
    ? (sp.theme as OverlayTheme)
    : null;
  const showBrand = sp.brand !== '0';
  const variant: OverlayVariant = (VARIANTS as readonly string[]).includes(sp.variant || '')
    ? (sp.variant as OverlayVariant)
    : 'default';
  return (
    <>
      {/* The app shell paints the paper background; a browser source needs
          transparency so only the lower-third card shows over the stream. */}
      <style>{'html, body { background: transparent !important; }'}</style>
      <OverlayView
        token={sp.token || ''}
        fallbackPreset={fallbackPreset}
        showBrand={showBrand}
        variant={variant}
      />
    </>
  );
}
