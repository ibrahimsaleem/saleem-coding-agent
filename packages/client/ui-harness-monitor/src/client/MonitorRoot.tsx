/**
 * The observability panel: a sidebar-foot trigger plus a full-viewport overlay
 * (position:fixed, the same technique the Settings panel uses). While open it
 * polls the host `monitor.snapshot` RPC every few seconds.
 * @module @deepseek-ai/dsh-client-ui-harness-monitor/client/MonitorRoot
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import clsx from 'clsx'
import type { HarnessMonitorKey } from './locales.ts'
import type {
  MonitorClient, MonitorSession, MonitorSnapshot, MonitorTimelineEntry,
} from './client-face.ts'
import { Bars, Donut, Sparkline, formatCompact, formatUsd, timeAgo } from './charts.tsx'
import css from './MonitorRoot.module.css'

type Translate = (key: HarnessMonitorKey) => string

const POLL_MS = 3000
const TABS = ['overview', 'sessions', 'security', 'processes'] as const
type Tab = (typeof TABS)[number]

/** Props the plugin hands the occupant. */
export interface MonitorRootProps {
  wide: boolean
  client: MonitorClient
  t: Translate
}

/**
 * Trigger + overlay.
 * @param props - sidebar width state, the RPC surface, and the translator.
 * @returns the sidebar-foot button and, when open, the overlay.
 */
export function MonitorRoot({ wide, client, t }: MonitorRootProps): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={clsx(css.trigger, !wide && css.triggerRail)}
        onClick={() => { setOpen(true) }}
        title={t('title')}
      >
        <span className={css.triggerIcon} aria-hidden>◧</span>
        {wide && <span>{t('trigger')}</span>}
      </button>
      {open && <MonitorOverlay client={client} t={t} onClose={() => { setOpen(false) }} />}
    </>
  )
}

/** The overlay body. */
function MonitorOverlay({ client, t, onClose }: { client: MonitorClient; t: Translate; onClose: () => void }): ReactElement {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [drillId, setDrillId] = useState<string | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    const poll = async (): Promise<void> => {
      try {
        const next = await client.snapshot(controller.signal)
        if (alive) { setSnapshot(next); setError(null) }
      } catch (e) {
        if (alive && !controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, POLL_MS)
    return () => { alive = false; controller.abort(); clearInterval(timer) }
  }, [client])

  const setGuard = useCallback(async (armed: boolean) => {
    const guard = await client.setGuardArmed(armed)
    setSnapshot(prev => (prev === null ? prev : { ...prev, guard }))
  }, [client])

  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label={t('title')}>
      <div className={css.mask} onClick={onClose} />
      <div className={css.panel}>
        <header className={css.header}>
          <h2 className={css.heading}>{t('title')}</h2>
          {snapshot !== null && (
            <span className={css.headerMeta}>
              {snapshot.homeLabel} · {t('updated')} {timeAgo(snapshot.generatedAt)}
            </span>
          )}
          <button ref={closeButton} type="button" className={css.closeButton} onClick={onClose} aria-label={t('close')}>✕</button>
        </header>

        {error !== null && <div className={css.errorBar}>{error}</div>}

        {snapshot === null
          ? <div className={css.empty}>{t('loading')}</div>
          : drillId !== null
            ? <Drill client={client} sessionId={drillId} onBack={() => { setDrillId(null) }} t={t} />
            : (
              <>
                <nav className={css.tabs}>
                  {TABS.map(id => (
                    <button
                      key={id}
                      type="button"
                      className={clsx(css.tab, tab === id && css.tabActive)}
                      onClick={() => { setTab(id) }}
                    >
                      {t(`tab${id.charAt(0).toUpperCase()}${id.slice(1)}` as HarnessMonitorKey)}
                    </button>
                  ))}
                </nav>
                <div className={css.body}>
                  {tab === 'overview' && <Overview snapshot={snapshot} t={t} />}
                  {tab === 'sessions' && <Sessions snapshot={snapshot} t={t} onOpen={setDrillId} onExport={() => { void exportCsv(client) }} />}
                  {tab === 'security' && <Security snapshot={snapshot} t={t} />}
                  {tab === 'processes' && <Processes snapshot={snapshot} t={t} client={client} onGuard={setGuard} />}
                </div>
              </>
            )}
      </div>
    </div>
  )
}

/** Trigger a browser download of the CSV export. */
async function exportCsv(client: MonitorClient): Promise<void> {
  const csv = await client.exportCsv()
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'harness-sessions.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/** One headline card. */
function Stat({ label, value, tone = 'none' }: { label: string; value: ReactNode; tone?: 'warn' | 'danger' | 'ok' | 'none' }): ReactElement {
  return (
    <div className={clsx(css.stat, tone !== 'none' && css[`stat_${tone}`])}>
      <span className={css.statValue}>{value}</span>
      <span className={css.statLabel}>{label}</span>
    </div>
  )
}

function Overview({ snapshot, t }: { snapshot: MonitorSnapshot; t: Translate }): ReactElement {
  const s = snapshot.summary
  const toolRows = Object.entries(snapshot.toolCallCounts)
    .sort(([, a], [, b]) => b - a).slice(0, 8)
    .map(([label, value]) => ({ label, value }))
  return (
    <div className={css.section}>
      <div className={css.statGrid}>
        <Stat label={t('statSessions')} value={s.sessionCount} />
        <Stat label={t('statRunning')} value={s.runningSessions} tone={s.runningSessions > 0 ? 'ok' : 'none'} />
        <Stat label={t('statProcesses')} value={s.processCount} />
        <Stat label={t('statTurns')} value={formatCompact(s.totalTurns)} />
        <Stat label={t('statToolCalls')} value={formatCompact(s.totalToolCalls)} />
        <Stat label={t('statTokens')} value={formatCompact(s.tokens.total)} />
        <Stat label={t('statCost')} value={formatUsd(s.estimatedCostUsd)} tone="ok" />
        <Stat label={t('statFindings')} value={s.securityFindingsCount} tone={s.securityFindingsCount > 0 ? 'danger' : 'ok'} />
        <Stat label={t('statRisky')} value={s.riskyPermissionSessions} tone={s.riskyPermissionSessions > 0 ? 'danger' : 'ok'} />
      </div>

      <div className={css.chartRow}>
        <figure className={css.chartCard}>
          <figcaption>{t('statTokens')}</figcaption>
          <Donut slices={[
            { label: 'Input', value: s.tokens.input, color: 'var(--monitor-accent)' },
            { label: 'Output', value: s.tokens.output, color: 'var(--dsw-alias-state-success-primary)' },
            { label: 'Cache read', value: s.tokens.cacheRead, color: 'var(--dsw-alias-label-tertiary)' },
            { label: 'Cache write', value: s.tokens.cacheWrite, color: 'var(--dsw-alias-state-warn-primary)' },
          ]} />
        </figure>
        <figure className={css.chartCard}>
          <figcaption>Activity, last 30 min</figcaption>
          <Sparkline points={snapshot.activityTimeline.map(b => b.count)} />
        </figure>
      </div>

      {toolRows.length > 0 && (
        <figure className={css.chartCard}>
          <figcaption>{t('statToolCalls')}</figcaption>
          <Bars rows={toolRows} />
        </figure>
      )}
    </div>
  )
}

function Sessions({ snapshot, t, onOpen, onExport }: {
  snapshot: MonitorSnapshot
  t: Translate
  onOpen: (id: string) => void
  onExport: () => void
}): ReactElement {
  if (snapshot.sessions.length === 0) return <div className={css.empty}>{t('noSessions')}</div>
  return (
    <div className={css.section}>
      <div className={css.sectionActions}>
        <button type="button" className={css.smallButton} onClick={onExport}>{t('exportCsv')}</button>
      </div>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Session</th><th>State</th><th>Turns</th><th>Tools</th><th>Tokens</th><th>Cost</th><th>Permission</th><th>Last</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.sessions.map(session => (
            <tr key={session.id} className={css.rowLink} onClick={() => { onOpen(session.id) }}>
              <td>{session.title ?? session.dirName}<span className={css.subtle}> · {session.workspace}</span></td>
              <td>{session.running ? <span className={css.badgeOk}>{t('running')}</span> : <span className={css.subtle}>{t('idle')}</span>}</td>
              <td>{session.turns}</td>
              <td>{session.toolCalls}</td>
              <td>{formatCompact(sessionTokens(session))}</td>
              <td>{formatUsd(session.cost.knownUsd)}{session.cost.unknownShare > 0 ? '*' : ''}</td>
              <td>{session.riskyPermission
                ? <span className={css.badgeDanger}>{session.permissions.preset ?? session.permissions.approval}</span>
                : <span className={css.subtle}>{session.permissions.preset ?? '—'}</span>}</td>
              <td className={css.subtle}>{session.lastActivity > 0 ? timeAgo(session.lastActivity) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {snapshot.summary.hasUnknownCost && <p className={css.subtle}>* {t('costUnknown')}</p>}
    </div>
  )
}

function sessionTokens(session: MonitorSession): number {
  const u = session.tokenUsage
  return u.input + u.output + u.cacheRead + u.cacheWrite
}

function Security({ snapshot, t }: { snapshot: MonitorSnapshot; t: Translate }): ReactElement {
  if (snapshot.securityFindings.length === 0) return <div className={css.empty}>{t('noFindings')}</div>
  return (
    <div className={css.section}>
      <table className={css.table}>
        <thead><tr><th>Severity</th><th>Pattern</th><th>Source</th><th>When</th><th>Snippet</th></tr></thead>
        <tbody>
          {snapshot.securityFindings.slice(0, 60).map((f, i) => (
            <tr key={`${f.ruleId}-${f.sessionId}-${i}`}>
              <td>
                <span className={clsx(css.badge, f.severity === 'high' ? css.badgeDanger : f.severity === 'medium' ? css.badgeWarn : css.badge)}>
                  {f.severity}
                </span>
                {f.autoKill && <span className={css.badgeDanger}>auto-kill</span>}
              </td>
              <td>{f.label}</td>
              <td className={css.subtle}>{f.source}</td>
              <td className={css.subtle}>{f.time > 0 ? timeAgo(f.time) : '—'}</td>
              <td><code className={css.snippet} title={f.snippet}>{f.snippet}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Processes({ snapshot, t, client, onGuard }: {
  snapshot: MonitorSnapshot
  t: Translate
  client: MonitorClient
  onGuard: (armed: boolean) => Promise<void>
}): ReactElement {
  const armed = snapshot.guard.armed
  const [busy, setBusy] = useState(false)
  const stop = async (): Promise<void> => {
    if (!window.confirm(t('stopConfirm'))) return
    setBusy(true)
    try { await client.killNow() } finally { setBusy(false) }
  }
  return (
    <div className={css.section}>
      <div className={clsx(css.guardCard, armed && css.guardCardArmed)}>
        <div>
          <strong>{t('guardTitle')}</strong>
          <span className={clsx(css.badge, armed ? css.badgeDanger : css.badgeOk)}>{armed ? t('guardArmed') : t('guardDisarmed')}</span>
          <p className={css.subtle}>{t('guardHint')}</p>
        </div>
        <div className={css.guardActions}>
          <button type="button" className={css.smallButton} onClick={() => { void onGuard(!armed) }}>
            {armed ? t('guardDisarm') : t('guardArm')}
          </button>
          <button type="button" className={clsx(css.smallButton, css.dangerButton)} disabled={busy} onClick={() => { void stop() }}>
            {t('stopNow')}
          </button>
        </div>
      </div>

      {snapshot.processes.length === 0
        ? <div className={css.empty}>{t('noProcesses')}</div>
        : (
          <table className={css.table}>
            <thead><tr><th>PID</th><th>Profile</th><th>Command</th></tr></thead>
            <tbody>
              {snapshot.processes.map(p => (
                <tr key={p.pid}>
                  <td>{p.pid}{p.self && <span className={css.subtle}> ({t('self')})</span>}</td>
                  <td>{p.profile}</td>
                  <td><code className={css.snippet} title={p.commandLine}>{p.commandLine}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  )
}

function Drill({ client, sessionId, onBack, t }: {
  client: MonitorClient
  sessionId: string
  onBack: () => void
  t: Translate
}): ReactElement {
  const [entries, setEntries] = useState<MonitorTimelineEntry[]>([])
  const [oldestSeq, setOldestSeq] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadPage = useCallback(async (beforeSeq?: number) => {
    setLoading(true)
    const page = await client.sessionTimeline({ sessionId, ...beforeSeq === undefined ? {} : { beforeSeq } })
    setLoading(false)
    if (page === null) return
    setEntries(prev => (beforeSeq === undefined ? page.timeline : [...page.timeline, ...prev]))
    setOldestSeq(page.oldestSeq)
    setHasMore(page.hasMore)
  }, [client, sessionId])

  useEffect(() => { void loadPage() }, [loadPage])

  return (
    <div className={css.section}>
      <div className={css.sectionActions}>
        <button type="button" className={css.smallButton} onClick={onBack}>← {t('tabSessions')}</button>
        <span className={css.subtle}>{sessionId}</span>
      </div>
      {hasMore && (
        <button type="button" className={css.smallButton} disabled={loading} onClick={() => { void loadPage(oldestSeq ?? undefined) }}>
          {t('loadEarlier')}
        </button>
      )}
      <ol className={css.timeline}>
        {entries.map((e, i) => (
          <li key={`${String(e.seq)}-${i}`} className={clsx(css.tlItem, e.compact && css.tlDivider)}>
            <span className={css.tlTime}>{e.time !== null ? timeAgo(e.time) : ''}</span>
            <span className={css.tlLabel}>{e.label}</span>
            {e.detail.length > 0 && <pre className={css.tlDetail}>{e.detail}</pre>}
          </li>
        ))}
      </ol>
      {loading && entries.length === 0 && <div className={css.empty}>{t('loading')}</div>}
    </div>
  )
}
