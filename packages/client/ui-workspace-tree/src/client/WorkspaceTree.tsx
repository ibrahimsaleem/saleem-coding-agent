/**
 * Workspace file-tree panel body: a lazily-expanding view of the active
 * workspace's files and folders. Each folder fetches its own children on first
 * expand (never eagerly, so a deep or wide workspace costs nothing until the
 * user opens into it) and keeps them cached in local state, keyed by the path
 * AND the reload generation it was fetched for — so switching sessions (which
 * changes `rootPath` on the same long-lived occupant, no remount) and the
 * Refresh button both trigger a fresh fetch instead of showing stale data.
 *
 * Interactions: expand/collapse a folder; click a file (or a folder's trailing
 * open affordance) to open it with the OS default app; a header toolbar with a
 * debounced recursive name search (backed by the Host, not the currently
 * loaded tree — so it finds matches anywhere in the workspace, not just in
 * folders the user has already opened), a hidden-file toggle, collapse-all,
 * and refresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DisclosureRow, IconChevronUpOutline14, IconCloseFill14, IconFolderClose16,
  IconFolderOpen16, IconPanelLeftOutline16, IconRefreshOutline16, IconRightUpOutline14, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { FileTypeIcon } from './file-icon.tsx'
import type {
  WorkspaceEntry, WorkspaceEntryListing, WorkspaceSearchListing,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import clsx from 'clsx'
import type { WorkspaceTreeKey } from './locales.ts'
import css from './WorkspaceTree.module.css'

/** One directory level's fetch state, tagged with the path+generation it was fetched for. */
type LevelState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; entries: readonly WorkspaceEntry[]; truncated: boolean }
  | { status: 'error'; key: string; message: string }

/** Recursive search state, debounced off the filter box. */
type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; results: readonly WorkspaceEntry[]; truncated: boolean }
  | { status: 'error'; message: string }

/** Debounce between the last keystroke and firing the recursive search request. */
const SEARCH_DEBOUNCE_MS = 300

/** Injected face: the wire calls, layout actions, and copy the panel drives. */
export interface WorkspaceTreeInjected {
  /** List one directory's files and subdirectories. */
  listWorkspaceEntries: (path: string, signal?: AbortSignal) => Promise<WorkspaceEntryListing>
  /** Recursively search the workspace by name (debounced by the caller). */
  searchWorkspaceEntries: (path: string, query: string, signal?: AbortSignal) => Promise<WorkspaceSearchListing>
  /** Open a file or folder with the OS default app (best-effort; rejects off-loopback). */
  openPath: (path: string) => Promise<void>
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

/** View controls shared by every level. */
interface TreeControls {
  listWorkspaceEntries: WorkspaceTreeInjected['listWorkspaceEntries']
  openPath: (path: string) => void
  t: Translate<WorkspaceTreeKey>
  /** Whether platform-hidden (dot-prefixed) entries are shown. */
  showHidden: boolean
  /** Bumped by Refresh — busts every level's cache. */
  reloadKey: number
  /** Bumped by Collapse all — every folder re-collapses. */
  collapseKey: number
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

/** `path`'s parent directory, workspace-relative (empty when it's the workspace root itself). */
function relativeParent(path: string, rootPath: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const parent = cut === -1 ? '' : path.slice(0, cut)
  const stripped = parent.startsWith(rootPath) ? parent.slice(rootPath.length) : parent
  return stripped.replace(/^[/\\]+/, '')
}

/**
 * Fetch one directory level on first expand, racing a superseded fetch (a fast
 * collapse/expand toggle, a session switch, a Refresh, or the row unmounting)
 * with an abort.
 * @param path - directory to list once `active` turns true.
 * @param active - whether this level should be loaded (the row is expanded).
 * @param reloadKey - Refresh generation; a change re-fetches even a cached level.
 * @param listWorkspaceEntries - the injected wire call.
 * @returns the level's current fetch state.
 */
function useLevel(
  path: string,
  active: boolean,
  reloadKey: number,
  listWorkspaceEntries: WorkspaceTreeInjected['listWorkspaceEntries'],
): LevelState {
  const [state, setState] = useState<LevelState>({ status: 'idle' })
  const key = `${reloadKey} ${path}`
  useEffect(() => {
    if (!active) return
    if (state.status === 'loading') return
    if ((state.status === 'ready' || state.status === 'error') && state.key === key) return
    const controller = new AbortController()
    setState({ status: 'loading', key })
    listWorkspaceEntries(path, controller.signal).then(
      (listing) => { setState({ status: 'ready', key, entries: listing.entries, truncated: listing.truncated }) },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', key, message: messageOf(error) })
      },
    )
    return () => { controller.abort() }
  }, [active, key, path, listWorkspaceEntries])
  return state
}

/**
 * Debounce a recursive workspace search off the filter box, cancelling a
 * superseded request (fast typing, a session switch, or the filter clearing).
 * @param rootPath - workspace root to search from; undefined disables search.
 * @param query - the trimmed filter text; empty means "not searching".
 * @param searchWorkspaceEntries - the injected wire call.
 * @returns the search's current state.
 */
function useSearch(
  rootPath: string | undefined,
  query: string,
  searchWorkspaceEntries: WorkspaceTreeInjected['searchWorkspaceEntries'],
): SearchState {
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  useEffect(() => {
    if (rootPath === undefined || query === '') {
      setState({ status: 'idle' })
      return
    }
    setState({ status: 'loading' })
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchWorkspaceEntries(rootPath, query, controller.signal).then(
        (listing) => { setState({ status: 'ready', results: listing.results, truncated: listing.truncated }) },
        (error: unknown) => {
          if (controller.signal.aborted) return
          setState({ status: 'error', message: messageOf(error) })
        },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => { clearTimeout(timer); controller.abort() }
  }, [rootPath, query, searchWorkspaceEntries])
  return state
}

/** Drop platform-hidden entries unless the hidden toggle is on. */
function visibleEntries(entries: readonly WorkspaceEntry[], controls: TreeControls): WorkspaceEntry[] {
  return entries.filter(entry => controls.showHidden || !entry.hidden)
}

/** One level's rows: loading/error/empty status, the entries themselves, or a truncation note. */
function LevelBody({ state, controls }: { state: LevelState; controls: TreeControls }): ReactNode {
  if (state.status === 'idle') return null
  if (state.status === 'loading') return <div className={css.status}>{controls.t('loading')}</div>
  if (state.status === 'error') return <div className={css.status}>{state.message}</div>
  const entries = visibleEntries(state.entries, controls)
  if (state.entries.length === 0) return <div className={css.status}>{controls.t('empty')}</div>
  if (entries.length === 0) return <div className={css.status}>{controls.t('noMatch')}</div>
  return (
    <>
      {entries.map(entry => (
        entry.kind === 'directory'
          ? <DirectoryRow key={entry.path} entry={entry} controls={controls} />
          : <FileRow key={entry.path} entry={entry} controls={controls} />
      ))}
      {state.truncated && <div className={css.status}>{controls.t('truncated', { count: String(state.entries.length) })}</div>}
    </>
  )
}

/** One expandable folder row; lazy-loads its children on first expand. */
function DirectoryRow({ entry, controls }: { entry: WorkspaceEntry; controls: TreeControls }): ReactNode {
  const [open, setOpen] = useState(false)
  const state = useLevel(entry.path, open, controls.reloadKey, controls.listWorkspaceEntries)

  useEffect(() => { setOpen(false) }, [controls.collapseKey])

  return (
    <DisclosureRow
      icon={open ? <IconFolderOpen16 /> : <IconFolderClose16 />}
      title={entry.name}
      open={open}
      expandable
      expandOnRowClick
      keepContentWhenOpen
      collapsedContent={(
        <button
          type="button"
          className={css.openButton}
          aria-label={controls.t('openFolder', { name: entry.name })}
          title={controls.t('openFolder', { name: entry.name })}
          onClick={(e) => { e.stopPropagation(); controls.openPath(entry.path) }}
        >
          <IconRightUpOutline14 />
        </button>
      )}
      onToggle={() => { setOpen(current => !current) }}
    >
      <div className={css.children}>
        <LevelBody state={state} controls={controls} />
      </div>
    </DisclosureRow>
  )
}

/** One file row; a click opens it with the OS default app. */
function FileRow({ entry, controls }: { entry: WorkspaceEntry; controls: TreeControls }): ReactNode {
  return (
    <button
      type="button"
      className={css.fileRow}
      title={controls.t('openFile', { name: entry.name })}
      onClick={() => { controls.openPath(entry.path) }}
    >
      <FileTypeIcon name={entry.name} className={css.fileIcon} />
      <span className={css.fileName}>{entry.name}</span>
    </button>
  )
}

/** One recursive search match; shows its workspace-relative parent directory alongside the name. */
function SearchResultRow({ entry, controls, rootPath }: { entry: WorkspaceEntry; controls: TreeControls; rootPath: string }): ReactNode {
  const dir = relativeParent(entry.path, rootPath)
  return (
    <button
      type="button"
      className={css.fileRow}
      title={entry.kind === 'directory' ? controls.t('openFolder', { name: entry.name }) : controls.t('openFile', { name: entry.name })}
      onClick={() => { controls.openPath(entry.path) }}
    >
      {entry.kind === 'directory' ? <IconFolderClose16 className={css.fileIcon} /> : <FileTypeIcon name={entry.name} className={css.fileIcon} />}
      <span className={css.fileName}>{entry.name}</span>
      {dir !== '' && <span className={css.searchResultDir}>{dir}</span>}
    </button>
  )
}

/** The filter box's recursive-search results view: loading/error/empty, the flat match list, or a truncation note. */
function SearchResults({ state, controls, rootPath }: { state: SearchState; controls: TreeControls; rootPath: string }): ReactNode {
  if (state.status === 'idle' || state.status === 'loading') return <div className={css.status}>{controls.t('searching')}</div>
  if (state.status === 'error') return <div className={css.status}>{state.message}</div>
  const results = visibleEntries(state.results, controls)
  if (results.length === 0) return <div className={css.status}>{controls.t('noMatch')}</div>
  return (
    <>
      {results.map(entry => <SearchResultRow key={entry.path} entry={entry} controls={controls} rootPath={rootPath} />)}
      {state.truncated && <div className={css.status}>{controls.t('searchTruncated')}</div>}
    </>
  )
}

/**
 * Render the workspace file-tree panel.
 * @param props - the active workspace's root path plus the injected wire calls, actions, and copy.
 * @returns the panel element.
 */
export function WorkspaceTree({
  rootPath, listWorkspaceEntries, searchWorkspaceEntries, openPath, onOpen, onClose, t,
}: WorkspaceTreeProps): ReactNode {
  const [rawFilter, setRawFilter] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [collapseKey, setCollapseKey] = useState(0)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => { onOpen() }, [onOpen])
  // Drop the filter and re-collapse when the workspace changes.
  useEffect(() => { setRawFilter(''); setCollapseKey(k => k + 1) }, [rootPath])

  const tryOpen = useCallback((path: string) => {
    setOpenError(null)
    openPath(path).catch((error: unknown) => { setOpenError(messageOf(error)) })
  }, [openPath])

  const controls = useMemo<TreeControls>(() => ({
    listWorkspaceEntries,
    openPath: tryOpen,
    t,
    showHidden,
    reloadKey,
    collapseKey,
  }), [listWorkspaceEntries, tryOpen, t, showHidden, reloadKey, collapseKey])

  const filter = rawFilter.trim()
  const searching = filter !== ''
  const root = useLevel(rootPath ?? '', rootPath !== undefined && !searching, reloadKey, listWorkspaceEntries)
  const search = useSearch(rootPath, filter, searchWorkspaceEntries)

  return (
    <div className={css.panel}>
      <div className={css.header}>
        <span className={css.headerTitle}>{rootPath === undefined ? t('title') : basename(rootPath)}</span>
        <button type="button" className={css.iconButton} onClick={onClose} aria-label={t('collapse')} title={t('collapse')}>
          <IconPanelLeftOutline16 className={css.mirror} />
        </button>
      </div>

      {rootPath !== undefined && (
        <div className={css.toolbar}>
          <div className={css.search}>
            <IconSearchOutline16 className={css.searchIcon} />
            <input
              className={css.searchInput}
              type="text"
              value={rawFilter}
              placeholder={t('filter')}
              onChange={(e) => { setRawFilter(e.target.value) }}
            />
            {rawFilter !== '' && (
              <button
                type="button"
                className={css.clearButton}
                aria-label={t('clearFilter')}
                onClick={() => { setRawFilter('') }}
              >
                <IconCloseFill14 />
              </button>
            )}
          </div>
          <button
            type="button"
            className={clsx(css.iconButton, showHidden && css.iconButtonActive)}
            aria-pressed={showHidden}
            aria-label={t('toggleHidden')}
            title={t('toggleHidden')}
            onClick={() => { setShowHidden(v => !v) }}
          >
            <span className={css.hiddenGlyph}>.*</span>
          </button>
          <button
            type="button"
            className={css.iconButton}
            title={t('collapseAll')}
            aria-label={t('collapseAll')}
            onClick={() => { setCollapseKey(k => k + 1) }}
          >
            <IconChevronUpOutline14 />
          </button>
          <button
            type="button"
            className={css.iconButton}
            title={t('refresh')}
            aria-label={t('refresh')}
            onClick={() => { setReloadKey(k => k + 1) }}
          >
            <IconRefreshOutline16 />
          </button>
        </div>
      )}

      {openError !== null && (
        <div className={css.errorBanner} role="alert">{t('openFailed')}</div>
      )}

      <div className={css.body}>
        {rootPath === undefined
          ? <div className={css.status}>{t('noWorkspace')}</div>
          : searching
            ? <SearchResults state={search} controls={controls} rootPath={rootPath} />
            : <LevelBody state={root} controls={controls} />}
      </div>
    </div>
  )
}
