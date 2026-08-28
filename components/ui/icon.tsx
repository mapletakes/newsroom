// A single source of truth for every icon in the app: plain Unicode dingbats
// instead of an icon font. Matches the hand-picked glyphs the deck already
// used for drag (⠿), collapse (▸▾), risk (⚠◐), and now-playing (▶) — no
// external font request, no FOUT, and it reads like print marginalia rather
// than generic software chrome. Icons are decorative by default (aria-hidden);
// the interactive element they sit in should carry its own aria-label.
const GLYPHS = {
  remove: '✕',
  close: '✕',
  clearAll: '⊗',
  external: '↗',
  announce: '»',
  drag: '⠿',
  expand: '▾',
  collapse: '▸',
  warning: '⚠',
  play: '▶',
  bookmark: '⚑',
  camera: '▣',
  radioChecked: '●',
  radioUnchecked: '○',
  themeSystem: '◐',
  themeLight: '○',
  themeDark: '●',
  themeSepia: '◒',
  themeContrast: '◧',
  themeBroadsheet: '◑',
  themeMidnight: '◕',
  themeAsh: '◎',
  themeColorblind: '◈',
  help: '?',
  mobile: '☏',
  raffle: '⚄',
} as const;

export type IconName = keyof typeof GLYPHS;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <span aria-hidden="true" className={className}>
      {GLYPHS[name]}
    </span>
  );
}
