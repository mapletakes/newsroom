// CSS slimming for frozen snapshots (lib/archive-freeze.ts). News pages ship
// megabytes of CSS for every template on the site, and once fonts are inlined
// that CSS is most of a snapshot's byte budget — on the sites we tested,
// fonts alone were 50–80% of a 4 MB snapshot. This keeps what the frozen page
// can actually use, the way SingleFile's "remove unused styles" does:
//
//  - rules whose selectors can't match anything in the document are dropped.
//    Matching is by token — every class, id and tag a selector requires must
//    exist somewhere in the page — which is cheap, never drops a rule that
//    could match, and is exact for a page whose scripts never run (no class
//    can be added later);
//  - @font-face rules survive only for families still named by a kept rule,
//    only for unicode-ranges and scripts the page's text actually uses, once
//    each, with a single source (woff2 preferred) instead of every format,
//    and at most a few faces per family: sites declare every weight and
//    italic they own, and a browser missing one substitutes the nearest
//    weight of the same family, which reads the same in an archive.

import postcss, { type AtRule, type ChildNode, type Container, type Root } from 'postcss';
import type * as cheerio from 'cheerio';

export type DocTokens = {
  classes: Set<string>;
  ids: Set<string>;
  tags: Set<string>;
  codepoints: Set<number>;
};

export function documentTokens($: cheerio.CheerioAPI): DocTokens {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const tags = new Set<string>();
  $('*').each((_, node) => {
    const el = node as { name?: string; attribs?: Record<string, string> };
    if (el.name) tags.add(el.name.toLowerCase());
    const cls = el.attribs?.class;
    if (cls) for (const c of cls.split(/\s+/)) if (c) classes.add(c);
    const id = el.attribs?.id;
    if (id) ids.add(id);
  });
  const codepoints = new Set<number>();
  for (const ch of $('body').text()) codepoints.add(ch.codePointAt(0)!);
  return { classes, ids, tags, codepoints };
}

/** A selector reduced to the parts that name classes, ids and tags:
 *  attribute selectors, pseudo-classes/elements (including functional ones
 *  like :not(...), whose contents aren't requirements) and nesting `&` are
 *  dropped. Escapes are honoured, so utility classes such as
 *  `.md\:text-\[2rem\]` keep their escaped colons and brackets. */
function simplifySelector(sel: string): string {
  let out = '';
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '\\') {
      out += c + (sel[i + 1] ?? '');
      i++;
    } else if (c === '[') {
      // Attribute selector: skip to its closing bracket, minding quotes.
      let quote = '';
      for (i++; i < sel.length; i++) {
        const d = sel[i];
        if (d === '\\') i++;
        else if (quote) {
          if (d === quote) quote = '';
        } else if (d === '"' || d === "'") quote = d;
        else if (d === ']') break;
      }
      out += ' ';
    } else if (c === ':') {
      // Pseudo-class or pseudo-element, with any (nested) argument list.
      let j = i + 1;
      if (sel[j] === ':') j++;
      while (j < sel.length && /[a-zA-Z-]/.test(sel[j])) j++;
      if (sel[j] === '(') {
        let depth = 1;
        for (j++; j < sel.length && depth; j++) {
          if (sel[j] === '\\') j++;
          else if (sel[j] === '(') depth++;
          else if (sel[j] === ')') depth--;
        }
      }
      i = j - 1;
    } else if (c === '&') {
      out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

const unescapeCss = (s: string) =>
  s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, '$1');

const NAME = String.raw`(?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w -￿-])+`;
const CLASS_RE = new RegExp(String.raw`(?<!\\)\.(${NAME})`, 'g');
const ID_RE = new RegExp(String.raw`(?<!\\)#(${NAME})`, 'g');

/** Whether every class, id and tag `sel` requires exists in the document.
 *  Anything it can't reason about (functional pseudos like :not/:is/:has,
 *  attribute selectors, namespaces) is treated as satisfiable. */
export function selectorCanMatch(sel: string, doc: DocTokens): boolean {
  const s = simplifySelector(sel);
  for (const m of s.matchAll(CLASS_RE)) {
    if (!doc.classes.has(unescapeCss(m[1]))) return false;
  }
  for (const m of s.matchAll(ID_RE)) {
    if (!doc.ids.has(unescapeCss(m[1]))) return false;
  }
  for (const compound of s.split(/[\s>+~]+/)) {
    const tag = /^[a-zA-Z][\w-]*/.exec(compound)?.[0];
    if (tag && !compound.includes('|') && !doc.tags.has(tag.toLowerCase())) return false;
  }
  return true;
}

const GROUPING_AT_RULES = new Set(['media', 'supports', 'layer', 'container', 'document', 'scope']);

function insideKeyframes(node: ChildNode): boolean {
  for (let p = node.parent; p; p = p.parent as Container | undefined) {
    if (p.type === 'atrule' && /keyframes$/i.test((p as AtRule).name)) return true;
  }
  return false;
}

function familiesIn(value: string): string[] {
  // var(--x, "Fallback") names "Fallback" too; the variable itself is
  // counted where it's defined (custom properties are read as families).
  return value
    .replace(/var\(\s*--[\w-]+\s*,?/g, ',')
    .replace(/\)/g, '')
    .split(',')
    .map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);
}

/** Families named by font-family / font declarations and by custom
 *  properties (design systems route fonts through var(--font-…), which we
 *  don't resolve — any family-looking custom property counts as used). */
function usedFamilies(root: Root, inlineStyles: string[] = []): Set<string> {
  const used = new Set<string>();
  const add = (prop: string, value: string) => {
    if (prop === 'font-family' || prop.startsWith('--')) familiesIn(value).forEach((f) => used.add(f));
    else if (prop === 'font') {
      // Families follow the size (and optional /line-height) in the shorthand.
      const m = /(?:^|\s)[\d.]+[a-z%]*(?:\/\S+)?\s+(.+)$/i.exec(value);
      if (m) familiesIn(m[1]).forEach((f) => used.add(f));
    }
  };
  root.walkDecls((d) => {
    if (d.parent?.type === 'atrule' && (d.parent as AtRule).name === 'font-face') return;
    add(d.prop.toLowerCase(), d.value);
  });
  for (const style of inlineStyles) {
    for (const m of style.matchAll(/(font-family|font|--[\w-]+)\s*:\s*([^;]+)/gi)) add(m[1].toLowerCase(), m[2]);
  }
  return used;
}

/** Parses `U+0000-00FF, U+0131, U+4??` and checks it against the page text. */
export function unicodeRangeUsed(range: string, codepoints: Set<number>): boolean {
  const spans: [number, number][] = [];
  for (const part of range.split(',')) {
    const m = /u\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
    if (!m) return true; // unparseable — keep the face
    if (m[1].includes('?')) spans.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'f'), 16)]);
    else spans.push([parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)]);
  }
  for (const cp of codepoints) if (spans.some(([a, b]) => cp >= a && cp <= b)) return true;
  return false;
}

// Font families made for one writing system, by name, and the characters
// that would need them. A page with none of those characters never uses the
// face, however many fallback stacks name it.
const SCRIPT_FAMILIES: [RegExp, RegExp][] = [
  [/arabic|urdu|persian|naskh|kufi/i, /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/],
  [/hebrew/i, /[\u0590-\u05FF]/],
  [/(^|[\s_-])(cjk|sc|tc|hk|jp|kr)([\s_-]|$)|japanese|korean|chinese|hangul|gothic\s*neo|mincho/i, /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/],
  [/thai/i, /[\u0E00-\u0E7F]/],
  [/devanagari|hindi/i, /[\u0900-\u097F]/],
  [/bengali|bangla/i, /[\u0980-\u09FF]/],
  [/tamil/i, /[\u0B80-\u0BFF]/],
  [/cyrillic/i, /[\u0400-\u04FF]/],
  [/greek/i, /[\u0370-\u03FF]/],
];

export function scriptFamilyUnused(family: string, codepoints: Set<number>): boolean {
  for (const [name, chars] of SCRIPT_FAMILIES) {
    if (!name.test(family)) continue;
    for (const cp of codepoints) if (chars.test(String.fromCodePoint(cp))) return false;
    return true;
  }
  return false;
}

const FACES_PER_FAMILY = 4;
const WEIGHT_RANK: Record<string, number> = { '400': 0, '700': 1, '500': 2, '600': 3, '300': 4, '800': 5, '900': 6 };

/** Lower is more essential: regular, bold, then other weights; upright
 *  before italic. A variable-weight face ("200 900") covers them all. */
export function faceRank(weight: string, style: string): number {
  const w = weight.trim().toLowerCase();
  const weightRank = /^\d+\s+\d+$/.test(w)
    ? -1
    : WEIGHT_RANK[w === 'bold' ? '700' : w === '' || w === 'normal' ? '400' : w] ?? 7;
  return weightRank + (/italic|oblique/i.test(style) ? 10 : 0);
}

/** Keeps local() entries and one url() — the first woff2, else the first. */
export function pickFontSrc(value: string): string {
  const entries = postcss.list.comma(value);
  const locals = entries.filter((e) => /^local\(/i.test(e.trim()));
  const urls = entries.filter((e) => /url\(/i.test(e));
  const best = urls.find((e) => /format\(\s*["']?woff2/i.test(e) || /\.woff2(?:[?#"')]|$)/i.test(e)) ?? urls[0];
  return [...locals, ...(best ? [best] : [])].join(', ');
}

/** Slims a page's stylesheets against its document. They're handled
 *  together because a site often declares its fonts in one sheet and uses
 *  them in another. A sheet that won't parse comes back unchanged rather
 *  than risking a broken page. `inlineStyles` are the page's style=""
 *  attributes, which can name fonts too. */
export function pruneStylesheets(sheets: string[], doc: DocTokens, inlineStyles: string[] = []): string[] {
  const roots = sheets.map((css) => {
    try {
      return postcss.parse(css);
    } catch {
      return null;
    }
  });

  const cache = new Map<string, boolean>();
  const canMatch = (sel: string) => {
    let v = cache.get(sel);
    if (v === undefined) {
      v = selectorCanMatch(sel, doc);
      cache.set(sel, v);
    }
    return v;
  };
  for (const root of roots) {
    if (!root) continue;
    root.walkRules((rule) => {
      if (insideKeyframes(rule)) return;
      const kept = rule.selectors.filter(canMatch);
      if (!kept.length) rule.remove();
      else if (kept.length < rule.selectors.length) rule.selectors = kept;
    });
    // Emptied @media/@supports/… blocks, innermost first.
    for (let changed = true; changed; ) {
      changed = false;
      root.walkAtRules((at) => {
        if (GROUPING_AT_RULES.has(at.name.toLowerCase()) && at.nodes && at.nodes.length === 0) {
          at.remove();
          changed = true;
        }
      });
    }
  }

  // Families still in use anywhere on the page. A sheet we couldn't parse
  // still counts, by a rougher read of its font-family declarations.
  const families = new Set<string>();
  roots.forEach((root, i) => {
    const used = root ? usedFamilies(root, []) : usedFamiliesInText(sheets[i]);
    used.forEach((f) => families.add(f));
  });
  usedFamiliesInText(inlineStyles.join(';')).forEach((f) => families.add(f));

  // When two faces share every descriptor, the browser uses the one
  // declared last, so only that one is kept.
  const effective = new Map<string, { face: AtRule; family: string; range: string; rank: number }>();
  for (const root of roots) {
    root?.walkAtRules('font-face', (face) => {
      let family = '';
      let range = '';
      let weight = '';
      let style = '';
      let stretch = '';
      let hasUrl = false;
      // Only the last src counts; earlier ones are IE-era .eot fallbacks.
      const srcs = face.nodes?.filter((n) => n.type === 'decl' && n.prop.toLowerCase() === 'src') ?? [];
      srcs.slice(0, -1).forEach((n) => n.remove());
      face.walkDecls((d) => {
        const p = d.prop.toLowerCase();
        if (p === 'font-family') family = familiesIn(d.value)[0] ?? '';
        else if (p === 'unicode-range') range = d.value;
        else if (p === 'font-weight') weight = d.value;
        else if (p === 'font-style') style = d.value;
        else if (p === 'font-stretch') stretch = d.value;
        else if (p === 'src') {
          d.value = pickFontSrc(d.value);
          hasUrl = /url\(/i.test(d.value);
        }
      });
      // local()-only faces (metric-matched fallbacks) cost nothing to keep.
      if (!hasUrl) return;
      if (
        !families.has(family) ||
        (range && !unicodeRangeUsed(range, doc.codepoints)) ||
        scriptFamilyUnused(family, doc.codepoints)
      ) {
        face.remove();
        return;
      }
      const key = [family, weight.trim(), style.trim(), stretch.trim(), range.replace(/\s+/g, '')].join('|');
      effective.get(key)?.face.remove();
      effective.set(key, { face, family, range, rank: faceRank(weight, style) });
    });
  }
  // Faces split by unicode-range are one logical face; rank them together.
  const byFamily = new Map<string, { face: AtRule; rank: number }[]>();
  for (const f of effective.values()) {
    const list = byFamily.get(`${f.family}|${f.range}`) ?? [];
    list.push(f);
    byFamily.set(`${f.family}|${f.range}`, list);
  }
  for (const list of byFamily.values()) {
    list.sort((a, b) => a.rank - b.rank).slice(FACES_PER_FAMILY).forEach(({ face }) => face.remove());
  }

  return roots.map((root, i) => (root ? root.toString() : sheets[i]));
}

function usedFamiliesInText(css: string): Set<string> {
  const used = new Set<string>();
  for (const m of css.matchAll(/(font-family|--[\w-]+)\s*:\s*([^;}]+)/gi)) familiesIn(m[2]).forEach((f) => used.add(f));
  return used;
}

/** The url()s inside @font-face rules, so the inliner can rank fonts below
 *  images when the byte budget is tight. */
export function fontFaceUrls(css: string): string[] {
  const out: string[] = [];
  for (const block of css.matchAll(/@font-face\s*{[^}]*}/gi)) {
    for (const m of block[0].matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) out.push(m[2]);
  }
  return out;
}
