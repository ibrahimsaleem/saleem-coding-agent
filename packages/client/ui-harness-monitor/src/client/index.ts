/**
 * Harness observability panel plugin: registers a trigger beside Settings at
 * the sidebar foot; clicking it opens a full-viewport overlay (the same CSS
 * technique the Settings panel uses) that polls the host `monitor.*` RPC every
 * few seconds for a live snapshot.
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the SlotMap merge declaring 'sidebar.footer.action'.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MonitorRoot } from './MonitorRoot.tsx'
import type { MonitorClient } from './client-face.ts'
import { en, zh, type HarnessMonitorKey } from './locales.ts'

export type { HarnessMonitorKey } from './locales.ts'
export type { MonitorClient } from './client-face.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The harness observability panel's copy. */
    'harness-monitor': HarnessMonitorKey
  }
}

/** Locale namespace owning the panel's copy. */
const LOCALE_NS = 'harness-monitor'

/** Required services: the slot registry, the API connection, and locale. */
export const inject = ['slots', 'connection', 'locale']

/** Injected face handed to the occupant. */
export interface MonitorInjected {
  /** The host monitor RPC surface. */
  client: MonitorClient
  /** Localized panel copy. */
  t: (key: HarnessMonitorKey) => string
}

/** The sidebar-foot occupant: the trigger button plus the overlay it toggles. */
function MonitorOccupant(props: PropsRuntime<'sidebar.footer.action'> & MonitorInjected): ReactElement {
  return createElement(MonitorRoot, { wide: props.wide, client: props.client, t: props.t })
}

/**
 * Client plugin body: register the panel's dictionaries and occupy a
 * `sidebar.footer.action` seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    const dictionaries: [locale: string, dict: Record<string, string>][] = [['zh', zh], ['en', en]]
    try {
      for (const [locale, dict] of dictionaries) disposers.push(ctx.locale.register(LOCALE_NS, locale, dict))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers) dispose() }
  }, 'harness-monitor: panel dictionaries')

  const injected = (): MonitorInjected => {
    const api = (ctx.get('connection') as ConnectionHandle).api.monitor
    const unwrap = <T>(response: { result: { ok: true; value: T } | { ok: false; error: { message: string } } }): T => {
      if (!response.result.ok) throw new Error(response.result.error.message)
      return response.result.value
    }
    const client: MonitorClient = {
      snapshot: async signal => unwrap(await api.snapshot({}, signal)),
      sessionTimeline: async (query, signal) => {
        const response = await api.sessionTimeline(query, signal)
        return response.result.ok ? response.result.value : null
      },
      setGuardArmed: async armed => unwrap(await api.setGuardArmed({ armed })),
      killNow: async () => unwrap(await api.killNow({})).killed,
      exportCsv: async () => unwrap(await api.exportCsv({})).csv,
    }
    return { client, t: ctx.locale.bind(LOCALE_NS) }
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'harness-monitor',
    order: -10,
    inject: injected,
    locale: LOCALE_NS,
  }, MonitorOccupant))
}
