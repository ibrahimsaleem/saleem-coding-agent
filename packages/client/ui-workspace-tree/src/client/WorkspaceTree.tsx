/**
 * Workspace file-tree panel body: a read-only, lazily-expanding view of the
 * active workspace's files and folders. Each folder fetches its own children
 * on first expand (never eagerly, so a deep or wide workspace costs nothing
 * until the user opens into it) and keeps them cached in local state, keyed
 * by the path it was fetched for — so switching sessions (which changes
 * `rootPath` on the same long-lived occupant, no remount) still refetches
 * the root level instead of showing the previous workspace's stale tree.
 * Read-only in this pass: expand/collapse is the only interaction; clicking a
 * file is inert (no content preview/open-in-editor yet).
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DisclosureRow, IconFileOutline16, IconFolderClose16, IconFolderOpen16, IconPanelLeftOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceEntry, WorkspaceEntryListing } from '@deepseek-ai/dsh-client-runtime/client'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { WorkspaceTreeKey } from './locales.ts'
import css from './WorkspaceTree.module.css'

/** One directory level's fetch state, tagged with the path it was (or is being) fetched for. */
type LevelState =
  | { status: 'idle' }
  | { status: 'loading'; path: string }
  | { status: 'ready'; path: string; entries: readonly WorkspaceEntry[] }
  | { status: 'error'; path: string; message: string }

/** Injected face: the wire call, layout actions, and copy the panel drives. */
export interface WorkspaceTreeInjected {
  /** List one directory's files and subdirectories. */
  listWorkspaceEntries: (path: string, signal?: AbortSignal) => Promise<WorkspaceEntryListing>
  /** Open the panel (ctx.layout.openTree) — called once on mount so the tree is visible by default. */
  onOpen: () => void
  /** Collapse the panel (ctx.layout.closeTree). */
  onClose: () => void
  /** Localized panel copy (this package's namespace). */
  t: Translate<WorkspaceTreeKey>
}

/** Full props: the injected face plus the active workspace's root path (undefined = none open). */
export interface WorkspaceTreeProps extends WorkspaceTreeInjected {
  rootPath: string | undefined
}

/** Message text of an unknown rejection. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Last path segment on either separator convention (host paths may be POSIX or Windows). */
function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const segment = trimmed.split(/[/\\]/).at(-1)
  return segment === undefined || segment.length === 0 ? path : segment
}

/**
 * Fetch one directory level on first expand, racing a superseded fetch (a
 * fast collapse/expand toggle, or the row itself unmounting) with an abort.
 * @param path - directory to list once `active` turns true.
 * @param active - whether this level should be loaded (the row is expanded).
 * @param listWorkspaceEntries - the injected wire call.
 * @returns the level's current fetch state.
 */
function useLevel(
  path: string,
  active: boolean,
  listWorkspaceEntries: WorkspaceTreeInjected['listWorkspaceEntries'],
): LevelState {
  const [state, setState] = useState<LevelState>({ status: 'idle' })
  useEffect(() => {
    if (!active) return
    // 'loading' always means a fetch for the current (active, path) pair is
    // already in flight (the effect only re-runs when they change). 'ready'
    // and 'error' are cached results — but only for the path they were
    // fetched for, so a session switch (path changes under an already-open
    // root row) still triggers a fresh fetch instead of showing stale data.
    if (state.status === 'loading') return
    if ((state.status === 'ready' || state.status === 'error') && state.path === path) return
    const controller = new AbortController()
    setState({ status: 'loading', path })
    listWorkspaceEntries(path, controller.signal).then(
      (listing) => { setState({ status: 'ready', path, entries: listing.entries }) },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', path, message: messageOf(error) })
      },
    )
    return () => { controller.abort() }
    // Re-running only on the fields that change what should be loaded: a
    // `state` dependency would refetch the instant setState above lands.
  }, [active, path, listWorkspaceEntries])
  return state
}

/** One level's rows: loading/error/empty status, or the entries themselves. */
function LevelBody({ state, listWorkspaceEntries, t }: {
  state: LevelState
  listWorkspaceEntries: WorkspaceTreeInjected['listWorkspaceEntries']
  t: Translate<WorkspaceTreeKey>
}): ReactNode {
  if (state.status === 'idle') return null
  if (state.status === 'loading') return <div className={css.status}>{t('loading')}</div>
  if (state.status === 'error') return <div className={css.status}>{state.message}</div>
  if (state.entries.length === 0) return <div className={css.status}>{t('empty')}</div>
  return (
    <>
      {state.entries.map(entry => (
        entry.kind === 'directory'
          ? <DirectoryRow key={entry.path} entry={entry} listWorkspaceEntries={listWorkspaceEntries} t={t} />
          : <FileRow key={entry.path} entry={entry} />
      ))}
    </>
  )
}

/** One expandable folder row; lazy-loads its children on first expand. */
function DirectoryRow({ entry, listWorkspaceEntries, t }: {
  entry: WorkspaceEntry
  listWorkspaceEntries: WorkspaceTreeInjected['listWorkspaceEntries']
  t: Translate<WorkspaceTreeKey>
}) {
  const [open, setOpen] = useState(false)
  const state = useLevel(entry.path, open, listWorkspaceEntries)
  return (
    <DisclosureRow
      icon={open ? <IconFolderOpen16 /> : <IconFolderClose16 />}
      title={entry.name}
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(current => !current) }}
    >
      <div className={css.children}>
        <LevelBody state={state} listWorkspaceEntries={listWorkspaceEntries} t={t} />
      </div>
    </DisclosureRow>
  )
}

/** One inert file row (no click action in this pass). */
function FileRow({ entry }: { entry: WorkspaceEntry }) {
  return (
    <div className={css.fileRow}>
      <IconFileOutline16 className={css.fileIcon} />
      <span className={css.fileName}>{entry.name}</span>
    </div>
  )
}

/**
 * Render the workspace file-tree panel.
 * @param props - the active workspace's root path plus the injected wire call, close action, and copy.
 * @returns the panel element.
 */
export function WorkspaceTree({ rootPath, listWorkspaceEntries, onOpen, onClose, t }: WorkspaceTreeProps): ReactNode {
  const root = useLevel(rootPath ?? '', rootPath !== undefined, listWorkspaceEntries)
  // Tree starts closed at the layout-store level (ui-layout's own contract
  // default, shared with details); opening it once here — the occupant
  // mounts exactly once for the app's lifetime, this slot being scope:
  // 'root' — is what makes the panel visible without an extra click, without
  // changing that shared default and its own test suite.
  useEffect(() => { onOpen() }, [onOpen])
  return (
    <div className={css.panel}>
      <div className={css.header}>
        <span className={css.headerTitle}>{rootPath === undefined ? t('title') : basename(rootPath)}</span>
        <button type="button" className={css.closeButton} onClick={onClose} aria-label={t('collapse')} title={t('collapse')}>
          <IconPanelLeftOutline16 className={css.closeButtonIcon} />
        </button>
      </div>
      <div className={css.body}>
        {rootPath === undefined
          ? <div className={css.status}>{t('noWorkspace')}</div>
          : <LevelBody state={root} listWorkspaceEntries={listWorkspaceEntries} t={t} />}
      </div>
    </div>
  )
}
