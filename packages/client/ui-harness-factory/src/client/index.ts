/**
 * Harness Factory plugin: registers a trigger beside Settings at the sidebar
 * foot; clicking it opens a full-viewport overlay where a user describes the
 * harness they want, generates it, and then runs or downloads it.
 *
 * Two deliberate choices here:
 *
 *  - **Run it** calls `session.create` with the new preset id rather than
 *    staging through the preset chip. `session.create` already takes
 *    `agentPreset`, so the harness is the session's composition from its first
 *    turn — no window where the session exists under the wrong preset, and no
 *    reach into another package's store.
 *  - **Download** is a plain `<a href download>` onto the host's GET route.
 *    The archive never passes through JavaScript, so a large harness costs no
 *    browser memory and the native download manager handles it.
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
import { FactoryRoot } from './FactoryRoot.tsx'
import type { HarnessClient } from './client-face.ts'
import { en, zh, type HarnessFactoryKey } from './locales.ts'

export type { HarnessFactoryKey } from './locales.ts'
export type { HarnessClient } from './client-face.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Harness Factory page's copy. */
    'harness-factory': HarnessFactoryKey
  }
}

/** Locale namespace owning the page's copy. */
const LOCALE_NS = 'harness-factory'

/** Required services: the slot registry, the API connection, and locale. */
export const inject = ['slots', 'connection', 'locale']

/** Injected face handed to the occupant. */
export interface FactoryInjected {
  /** The host harness RPC surface. */
  client: HarnessClient
  /** Localized page copy. */
  t: (key: HarnessFactoryKey) => string
}

/** The sidebar-foot occupant: the trigger button plus the overlay it toggles. */
function FactoryOccupant(props: PropsRuntime<'sidebar.footer.action'> & FactoryInjected): ReactElement {
  return createElement(FactoryRoot, { wide: props.wide, client: props.client, t: props.t })
}

/**
 * Client plugin body: register the page's dictionaries and occupy a
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
  }, 'harness-factory: page dictionaries')

  const injected = (): FactoryInjected => {
    const api = (ctx.get('connection') as ConnectionHandle).api
    const unwrap = <T>(response: { result: { ok: true; value: T } | { ok: false; error: { message: string } } }): T => {
      if (!response.result.ok) throw new Error(response.result.error.message)
      return response.result.value
    }
    const client: HarnessClient = {
      templates: async signal => unwrap(await api.harness.templates({}, signal)),
      generate: async (prompt, template, signal) => unwrap(await api.harness.generate(
        { prompt, ...template === undefined ? {} : { template } },
        signal,
      )).harness,
      runHarness: (agentPreset) => {
        // Fire-and-forget then reload: the session list is a live projection,
        // and the host makes the new session current. Awaiting here would only
        // delay the navigation the user is already expecting.
        void (async () => {
          await api.sessions.create({ agentPreset })
          window.location.reload()
        })()
      },
      downloadUrl: (agentPreset, mode) =>
        `/api/harness.export?agentPreset=${encodeURIComponent(agentPreset)}&mode=${mode}`,
    }
    return { client, t: ctx.locale.bind(LOCALE_NS) }
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'harness-factory',
    order: -20,
    inject: injected,
    locale: LOCALE_NS,
  }, FactoryOccupant))
}
