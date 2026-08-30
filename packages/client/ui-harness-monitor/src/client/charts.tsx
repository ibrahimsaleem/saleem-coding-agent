/**
 * Dependency-free inline-SVG chart primitives, styled with `--dsw-*` tokens —
 * the same hand-rolled approach `ui-primitives` uses for icons and StateDot.
 * @module @deepseek-ai/dsh-client-ui-harness-monitor/client/charts
 */

import type { ReactElement } from 'react'
import css from './MonitorRoot.module.css'

/** One labelled slice. */
export interface Slice {
  label: string
  value: number
  color: string
}

/**
 * A donut chart drawn with stroke-dasharray on overlapping circles.
 * @param props.slices - non-negative slices (zero slices are dropped).
 * @param props.size - square viewport in px.
 */
export function Donut({ slices, size = 120 }: { slices: Slice[]; size?: number }): ReactElement {
  const shown = slices.filter(s => s.value > 0)
  const total = shown.reduce((sum, s) => sum + s.value, 0)
  const thickness = Math.round(size * 0.16)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className={css.donutWrap}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={css.donut} role="img">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--dsw-alias-border-l2)" strokeWidth={thickness} />
        {total > 0 && shown.map((s) => {
          const dash = (s.value / total) * c
          const node = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )
          offset += dash
          return node
        })}
      </svg>
      <ul className={css.legend}>
        {shown.map(s => (
          <li key={s.label}>
            <span className={css.swatch} style={{ background: s.color }} />
            {s.label} · {formatCompact(s.value)}
            {total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A filled-area sparkline.
 * @param props.points - series values, oldest first.
 */
export function Sparkline({ points, width = 320, height = 56 }: { points: number[]; width?: number; height?: number }): ReactElement {
  const max = Math.max(1, ...points)
  const stepX = width / Math.max(1, points.length - 1)
  const coords = points.map((v, i) => [i * stepX, height - (v / max) * (height - 6) - 3] as const)
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width} ${height} L0 ${height} Z`
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={css.spark} role="img">
      <path d={area} fill="var(--monitor-accent)" opacity={0.18} />
      <path d={line} fill="none" stroke="var(--monitor-accent)" strokeWidth={1.5} />
    </svg>
  )
}

/** One horizontal bar. */
export interface Bar {
  label: string
  value: number
}

/**
 * A horizontal-bar list (plain divs, width as a percentage of the max).
 * @param props.rows - bars, any order; rendered as given.
 */
export function Bars({ rows, format = formatCompact }: { rows: Bar[]; format?: (n: number) => string }): ReactElement {
  const max = Math.max(1, ...rows.map(r => r.value))
  return (
    <div className={css.bars}>
      {rows.map(r => (
        <div key={r.label} className={css.barRow}>
          <span className={css.barName} title={r.label}>{r.label}</span>
          <span className={css.barTrack}><span className={css.barFill} style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className={css.barNum}>{format(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** Compact number ("7.9M"). */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** USD, with a tiny-amount floor. */
export function formatUsd(n: number): string {
  if (n > 0 && n < 0.01) return '<$0.01'
  return `$${n.toFixed(n < 1 ? 4 : 2)}`
}

/** Relative time ("3m ago"). */
export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
