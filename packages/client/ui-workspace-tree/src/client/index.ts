/**
 * Workspace file-tree panel plugin: fills ui-layout's `workspaceTree` column
 * with a read-only, lazily-expanding view of the active workspace's files and
 * folders. The active workspace is resolved the same way the sidebar's
 * workspace list derives it: current session id (useSessions) joined against
 * the workspace whose sessionIds includes it (useWorkspaces).
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the 'workspaceTree' slot.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { WorkspaceTree } from './WorkspaceTree.tsx'
import type { WorkspaceTreeInjected } from './WorkspaceTree.tsx'
import { en, zh, type WorkspaceTreeKey } from './locales.ts'

export type { WorkspaceTreeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace file-tree panel's copy. */
    'workspace-tree': WorkspaceTreeKey
  }
}

/** Locale namespace owning the panel's copy. */
const LOCALE_NS = 'workspace-tree'

/** Required services (cordis fiber inject): the slot registry, workspaces/sessions data, layout actions, and locale. */
export const inject = ['slots', 'workspaces', 'layout', 'locale']

/** The occupant component: resolves the active workspace, then renders the panel body. */
function WorkspaceTreeOccupant(
  props: PropsRuntime<'workspaceTree'> & WorkspaceTreeInjected,
): ReactElement {
  const currentSessionId = props.useSessions(s => s.current)
  const rootPath = props.useWorkspaces((list) => {
    if (currentSessionId === undefined) return undefined
    return list.items.find(w => w.sessionIds.includes(currentSessionId))?.path
  })
  return createElement(WorkspaceTree, {
    rootPath,
    listWorkspaceEntries: props.listWorkspaceEntries,
    openPath: props.openPath,
    onOpen: props.onOpen,
    onClose: props.onClose,
    t: props.t,
  })
}

/**
 * Client plugin body: register the panel's dictionaries and occupy the
 * `workspaceTree` column.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    const dictionaries: [locale: string, dict: Record<string, string>][] = [
      ['zh', zh],
      ['en', en],
    ]
    try {
      for (const [locale, dict] of dictionaries) disposers.push(ctx.locale.register(LOCALE_NS, locale, dict))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers) dispose() }
  }, 'workspace-tree: panel dictionaries')

  const injected = (): WorkspaceTreeInjected => ({
    listWorkspaceEntries: (path, signal) => ctx.workspaces.listWorkspaceEntries(path, signal),
    openPath: path => ctx.workspaces.openPath(path),
    onOpen: () => { ctx.layout.openTree() },
    onClose: () => { ctx.layout.closeTree() },
    t: ctx.locale.bind(LOCALE_NS),
  })
  ctx.slots.inject('workspaceTree', () => ctx.slots.register({
    name: 'workspaceTree',
    inject: injected,
    locale: LOCALE_NS,
  }, WorkspaceTreeOccupant))
}
