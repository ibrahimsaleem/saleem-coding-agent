/**
 * Free Model Router settings plugin, browser half. Registers a
 * `settings.section` page that enables free platforms, stores their keys, and
 * shows per-candidate health. Loopback-only in practice (the underlying
 * `router.*` / `credentials.*` / `settings.*` writes are).
 * @module @ibrahimsaleem/dsh-client-ui-free-model-router/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: ctx.locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: ctx.remote forwarded-event keys.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { FreeRouterSection } from './FreeRouterSection.tsx'
import type { FreeRouterInjected } from './FreeRouterSection.tsx'
import { FreeRouterStore } from './store.ts'
import { en, zh, type FreeRouterKey } from './locales.ts'

export type { FreeRouterKey } from './locales.ts'
export type { FreeRouterState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Free Model Router settings page. */
    'settings.freeModelRouter': FreeRouterKey
  }
}

const NS = 'settings.freeModelRouter' as const

/** Required client services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'remote']

/** Register the Free Model Router settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-free-model-router: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new FreeRouterStore(connection.api)
  const t = ctx.locale.bind(NS) as (key: FreeRouterKey) => string

  const injected = (): FreeRouterInjected & { controller: FreeRouterStore } => ({
    hooks: { snapshot: controller.store },
    controller,
  })

  ctx.effect(() => {
    const refresh = (): void => {
      if (controller.store.getSnapshot().status !== 'idle') void controller.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', refresh),
      ctx.remote.$on('credentials/reference-updated', refresh),
      ctx.remote.$on('llm/adapters-updated', refresh),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-free-model-router: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'free-model-router',
    order: 15,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, FreeRouterSection))
}
