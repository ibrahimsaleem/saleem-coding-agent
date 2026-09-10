/**
 * Per-file-type icon for a tree row: a small solid-color badge with a 1-2
 * character monogram (the same technique VS Code / GitHub use for language
 * marks — at 16px there is only room for a large, near-full-bleed glyph, not
 * a small mark inside a document silhouette) — so `index.ts` and `main.py`
 * are distinguishable at a glance instead of every file rendering the same
 * neutral glyph. Unrecognized extensions (and extensionless files outside
 * the curated exact-name list) fall back to the plain `IconFileOutline16`.
 */
import type { ReactNode } from 'react'
import { IconFileOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/** One file type's badge: 1-2 characters, its fill color, and an optional dark-text override for pale fills. */
interface FileTypeStyle {
  label: string
  fill: string
  dark?: true
}

/** Extension (no dot, lowercase) → badge. Same-language variants (e.g. .mjs/.cjs) share one entry via {@link EXTENSION_ALIASES}. */
const EXTENSION_STYLES: Record<string, FileTypeStyle> = {
  ts: { label: 'TS', fill: '#3178C6' },
  tsx: { label: 'TS', fill: '#3178C6' },
  js: { label: 'JS', fill: '#F0DB4F', dark: true },
  jsx: { label: 'JS', fill: '#F0DB4F', dark: true },
  py: { label: 'PY', fill: '#3776AB' },
  rb: { label: 'RB', fill: '#CC342D' },
  go: { label: 'GO', fill: '#00ACD7' },
  rs: { label: 'RS', fill: '#DE7B34' },
  java: { label: 'J', fill: '#EA2D2E' },
  kt: { label: 'KT', fill: '#7F52FF' },
  swift: { label: 'SW', fill: '#F05138' },
  c: { label: 'C', fill: '#5C6BC0' },
  h: { label: 'H', fill: '#5C6BC0' },
  cpp: { label: 'C+', fill: '#00599C' },
  hpp: { label: 'C+', fill: '#00599C' },
  cs: { label: 'C#', fill: '#178600' },
  php: { label: 'PH', fill: '#777BB4' },
  sh: { label: 'SH', fill: '#89E051', dark: true },
  ps1: { label: 'PS', fill: '#012456' },
  lua: { label: 'LU', fill: '#000E7F' },
  sql: { label: 'SQ', fill: '#E38C00' },
  r: { label: 'R', fill: '#276DC3' },
  scala: { label: 'SC', fill: '#DC322F' },
  dart: { label: 'DT', fill: '#0175C2' },
  ex: { label: 'EX', fill: '#6E4A7E' },
  exs: { label: 'EX', fill: '#6E4A7E' },
  clj: { label: 'CJ', fill: '#5881D8' },
  hs: { label: 'HS', fill: '#5D4F85' },
  pl: { label: 'PL', fill: '#0298C3' },
  vim: { label: 'VM', fill: '#019833' },
  tex: { label: 'TX', fill: '#3D6117' },
  jl: { label: 'JL', fill: '#9558B2' },
  zig: { label: 'ZG', fill: '#F7A41D', dark: true },
  nim: { label: 'NM', fill: '#FFC200', dark: true },
  elm: { label: 'EL', fill: '#1293D8' },
  erl: { label: 'ER', fill: '#A90533' },
  fs: { label: 'FS', fill: '#378BBA' },
  vue: { label: 'VU', fill: '#42B883' },
  svelte: { label: 'SV', fill: '#FF3E00' },

  json: { label: '{}', fill: '#F1C40F', dark: true },
  yaml: { label: 'YM', fill: '#CB171E' },
  toml: { label: 'TM', fill: '#9C4221' },
  xml: { label: 'XM', fill: '#005FAD' },
  md: { label: 'MD', fill: '#083FA1' },
  mdx: { label: 'MX', fill: '#6E56CF' },
  html: { label: '<>', fill: '#E34C26' },
  css: { label: 'CS', fill: '#264DE4' },
  scss: { label: 'SC', fill: '#C6538C' },
  less: { label: 'LS', fill: '#1D365D' },
  svg: { label: 'SV', fill: '#FFB13B', dark: true },
  csv: { label: 'CV', fill: '#237346' },
  ini: { label: 'IN', fill: '#6D6D6D' },
  env: { label: 'EN', fill: '#ECD53F', dark: true },
  graphql: { label: 'GQ', fill: '#E10098' },
  proto: { label: 'PB', fill: '#4285F4' },

  pdf: { label: 'PD', fill: '#E2492D' },
  txt: { label: 'TX', fill: '#6D6D6D' },
  log: { label: 'LG', fill: '#6D6D6D' },

  png: { label: 'IMG', fill: '#9C6ADE' },
  jpg: { label: 'IMG', fill: '#9C6ADE' },
  jpeg: { label: 'IMG', fill: '#9C6ADE' },
  gif: { label: 'IMG', fill: '#9C6ADE' },
  webp: { label: 'IMG', fill: '#9C6ADE' },
  bmp: { label: 'IMG', fill: '#9C6ADE' },
  ico: { label: 'IMG', fill: '#9C6ADE' },

  zip: { label: 'ZP', fill: '#6D6D6D' },
  tar: { label: 'ZP', fill: '#6D6D6D' },
  gz: { label: 'ZP', fill: '#6D6D6D' },
  tgz: { label: 'ZP', fill: '#6D6D6D' },
  rar: { label: 'ZP', fill: '#6D6D6D' },
  '7z': { label: 'ZP', fill: '#6D6D6D' },

  lock: { label: 'LK', fill: '#6D6D6D' },
}

/** Extension spellings that share another extension's badge. */
const EXTENSION_ALIASES: Record<string, string> = {
  mts: 'ts', cts: 'ts', mjs: 'js', cjs: 'js', pyw: 'py', pyi: 'py',
  bash: 'sh', zsh: 'sh', cc: 'cpp', cxx: 'cpp', hh: 'hpp', hxx: 'hpp',
  yml: 'yaml', htm: 'html', sass: 'scss', jsonc: 'json', cjson: 'json',
  cljs: 'clj', cljc: 'clj', pm: 'pl', gql: 'graphql', markdown: 'md',
  latex: 'tex', sty: 'tex', cls: 'tex', fsx: 'fs', fsi: 'fs',
}

/** Full lowercased filenames (dotfiles and extensionless conventions) with their own badge, checked before the extension table. */
const EXACT_NAME_STYLES: Record<string, FileTypeStyle> = {
  dockerfile: { label: 'DK', fill: '#2496ED' },
  makefile: { label: 'MK', fill: '#6D4C41' },
  readme: { label: 'MD', fill: '#083FA1' },
  license: { label: 'LC', fill: '#D4AC0D', dark: true },
  '.gitignore': { label: 'GI', fill: '#F14E32' },
  '.gitattributes': { label: 'GI', fill: '#F14E32' },
  '.gitmodules': { label: 'GI', fill: '#F14E32' },
  '.npmrc': { label: 'NP', fill: '#CB3837' },
  '.editorconfig': { label: 'CF', fill: '#6D6D6D' },
  '.env': { label: 'EN', fill: '#ECD53F', dark: true },
}

/** `name`'s extension (lowercase, no dot); undefined for a dotfile or a name with no extension. */
function extensionOf(name: string): string | undefined {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return undefined
  return name.slice(dot + 1).toLowerCase()
}

/** Resolve `name`'s badge style, or undefined for anything not in the curated tables. */
function styleFor(name: string): FileTypeStyle | undefined {
  const lower = name.toLowerCase()
  if (lower in EXACT_NAME_STYLES) return EXACT_NAME_STYLES[lower]
  const startsWithEnv = lower.startsWith('.env.') || lower.startsWith('.env-')
  if (startsWithEnv) return EXACT_NAME_STYLES['.env']
  const ext = extensionOf(name)
  if (ext === undefined) return undefined
  const key = EXTENSION_ALIASES[ext] ?? ext
  return EXTENSION_STYLES[key]
}

/**
 * A small solid-color badge monogrammed for `name`'s recognized type; the
 * plain neutral file glyph for anything unrecognized.
 * @param name - the file's base name (extension and a handful of exact
 * conventional names like `Dockerfile` or `.gitignore` are checked).
 * @param className - forwarded to the rendered icon, same as every other icon in the tree.
 * @returns the icon element.
 */
export function FileTypeIcon({ name, className }: { name: string; className?: string | undefined }): ReactNode {
  const style = styleFor(name)
  if (style === undefined) return <IconFileOutline16 className={className} />
  // Near-full-bleed square, not the document silhouette: at 16px there is
  // only room for one large glyph, and every pixel spent on a page outline
  // is a pixel not available for a legible monogram.
  const fontSize = style.label.length >= 3 ? 6 : style.label.length === 2 ? 8 : 10
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill={style.fill} />
      <text
        x="8"
        y="8.4"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        letterSpacing="-0.2"
        fill={style.dark === true ? '#1a1a1a' : '#fff'}
      >
        {style.label}
      </text>
    </svg>
  )
}
