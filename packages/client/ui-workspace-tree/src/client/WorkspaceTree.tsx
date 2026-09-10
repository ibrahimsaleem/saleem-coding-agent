/**
 * Workspace file-tree panel body: a lazily-expanding view of the active
 * workspace's files and folders. Each folder fetches its own children on first
 * expand (never eagerly, so a deep or wide workspace costs nothing until the
 * user opens into it) and keeps them cached in local state, keyed by the path
 * AND the reload generation it was fetched for — so switching sessions (which
 * changes `rootPath` on the same long-lived occupant, no remount) and the
 * Refresh button both trigger a fresh fetch instead of showing stale data.
 *
 * Interactions: expand/collapse a folder (click, Enter/Space, or arrow keys
 * once focus is inside the tree — Up/Down/Home/End move between rows,
 * Right/Left expand/collapse); click a file (or a folder's trailing open
 * affordance) to open it with the OS default app; a hover-reveal button
 * copies a row's workspace-relative path; git-tracked rows show a colored
 * status letter and a gitignored path dims; a header toolbar with a debounced
 * recursive name search (backed by the Host, not the currently loaded tree —
 * so it finds matches anywhere in the workspace, highlighting the matched
 * substring), a hidden-file toggle, collapse-all, and refresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import {
  DisclosureRow, IconCheckOutline16, IconChevronUpOutline14, IconCloseFill14, IconCopyOutline16,
  IconFolderClose16, IconFolderOpen16, IconPanelLeftOutline16, IconRefreshOutline16, IconRightUpOutline14,
  IconSearchOutline16, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { FileTypeIcon } from './file-icon.tsx'
import type {
  GitPathStatus, GitWorkspaceStatus, WorkspaceEntry, WorkspaceEntryListing, WorkspaceSearchListing,
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

/** The workspace's git summary, indexed for O(1) per-row lookups. */
interface GitStatusData {
  /** Absolute path → its working-tree status. */
  byPath: ReadonlyMap<string, GitPathStatus['status']>
  /** Absolute paths git reports as ignored (see {@link GitWorkspaceStatus.ignored}). */
  ignored: readonly string[]
}

const EMPTY_GIT_STATUS: GitStatusData = { byPath: new Map(), ignored: [] }

/** Injected face: the wire calls, layout actions, and copy the panel drives. */
export interface WorkspaceTreeInjected {
  /** List one directory's files and subdirectories. */
  listWorkspaceEntries: (path: string, signal?: AbortSignal) => Promise<WorkspaceEntryListing>
  /** Recursively search the workspace by name (debounced by the caller). */
  searchWorkspaceEntries: (path: string, query: string, signal?: AbortSignal) => Promise<WorkspaceSearchListing>
  /** Git working-tree summary for status badges and gitignored dimming (never rejects; resolves `available: false` when there is none). */
  gitStatus: (path: string, signal?: AbortSignal) => Promise<GitWorkspaceStatus>
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
  /** The active workspace root; `''` when none is open (rows never render in that state). */
  rootPath: string
  /** Whether platform-hidden (dot-prefixed) entries are shown. */
  showHidden: boolean
  /** Bumped by Refresh — busts every level's cache (and re-fetches git status). */
  reloadKey: number
  /** Bumped by Collapse all — every folder re-collapses. */
  collapseKey: number
  gitStatusByPath: ReadonlyMap<string, GitPathStatus['status']>
  ignoredPaths: readonly string[]
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

/** `path` itself, workspace-relative (no leading separator); `path` unchanged if somehow outside `rootPath`. */
function relativeTo(path: string, rootPath: string): string {
  if (!path.startsWith(rootPath)) return path
  return path.slice(rootPath.length).replace(/^[/\\]+/, '')
}

/** `path` is ignored: it's exactly one of `ignored`, or nested under one of them. */
function isIgnored(path: string, ignored: readonly string[]): boolean {
  return ignored.some(root => path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`))
}

/** Bold the first case-insensitive occurrence of `query` in `text`; `text` unchanged when `query` is empty or absent. */
function highlightMatch(text: string, query: string): ReactNode {
  if (query === '') return text
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className={css.matchHighlight}>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
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

/**
 * Fetch the workspace's git working-tree summary once per root+reload
 * generation (so Refresh also refreshes status badges/dimming), indexed for
 * O(1) per-row lookups. Resolves to empty rather than surfacing an error —
 * this is a nice-to-have indicator, never a blocking concern.
 * @param rootPath - workspace root; undefined clears the summary.
 * @param reloadKey - Refresh generation; a change re-fetches.
 * @param gitStatus - the injected wire call.
 * @returns the indexed summary.
 */
function useGitStatus(
  rootPath: string | undefined,
  reloadKey: number,
  gitStatus: WorkspaceTreeInjected['gitStatus'],
): GitStatusData {
  const [data, setData] = useState<GitStatusData>(EMPTY_GIT_STATUS)
  useEffect(() => {
    if (rootPath === undefined) { setData(EMPTY_GIT_STATUS); return }
    const controller = new AbortController()
    gitStatus(rootPath, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        setData(result.available
          ? { byPath: new Map(result.changes.map(change => [change.path, change.status] as const)), ignored: result.ignored }
          : EMPTY_GIT_STATUS)
      },
      () => { if (!controller.signal.aborted) setData(EMPTY_GIT_STATUS) },
    )
    return () => { controller.abort() }
  }, [rootPath, reloadKey, gitStatus])
  return data
}

/** Drop platform-hidden entries unless the hidden toggle is on. */
function visibleEntries(entries: readonly WorkspaceEntry[], controls: TreeControls): WorkspaceEntry[] {
  return entries.filter(entry => controls.showHidden || !entry.hidden)
}

/** Every keyboard-focusable tree row inside `container`, in visual (DOM) order. */
function treeRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-disclosure-row], [data-tree-row]'))
}

/**
 * Arrow-key navigation once focus is already inside the tree body: Up/Down
 * move to the adjacent row in visual order, Home/End jump to the first/last,
 * Right expands a focused collapsed directory, Left collapses a focused
 * expanded one. Every row keeps its native Tab stop — this adds a faster
 * path on top rather than replacing it with a roving-tabindex pattern.
 * @param event - the body container's keydown event.
 */
function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
  const { key } = event
  const isMoveKey = key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End'
  const isFoldKey = key === 'ArrowRight' || key === 'ArrowLeft'
  if (!isMoveKey && !isFoldKey) return
  const active = document.activeElement
  const container = event.currentTarget
  if (!(active instanceof HTMLElement) || !container.contains(active)) return
  if (isFoldKey) {
    // Only a directory's disclosure row folds; a file row (or nested action
    // button) ignores Left/Right rather than guessing an intent.
    if (active.getAttribute('data-disclosure-row') === null) return
    const expanded = active.getAttribute('aria-expanded') === 'true'
    if ((key === 'ArrowRight' && !expanded) || (key === 'ArrowLeft' && expanded)) {
      event.preventDefault()
      active.click()
    }
    return
  }
  const rows = treeRows(container)
  if (rows.length === 0) return
  event.preventDefault()
  if (key === 'Home') { rows[0]?.focus(); return }
  if (key === 'End') { rows[rows.length - 1]?.focus(); return }
  const index = rows.indexOf(active)
  const nextIndex = index === -1 ? 0 : key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0)
  rows[nextIndex]?.focus()
}

/** Colors follow the same modified/added-or-untracked/deleted/renamed convention as VS Code and GitHub. */
const GIT_STATUS_STYLE: Record<GitPathStatus['status'], { letter: string; color: string }> = {
  modified: { letter: 'M', color: '#E2B93D' },
  added: { letter: 'A', color: '#3FB950' },
  untracked: { letter: 'U', color: '#3FB950' },
  deleted: { letter: 'D', color: '#F85149' },
  renamed: { letter: 'R', color: '#58A6FF' },
  conflicted: { letter: 'C', color: '#F85149' },
}

/** Small colored letter badge for a row's git working-tree status; renders nothing when the path has none. */
function GitStatusBadge({ status }: { status: GitPathStatus['status'] | undefined }): ReactNode {
  if (status === undefined) return null
  const style = GIT_STATUS_STYLE[status]
  return <span className={css.gitBadge} style={{ color: style.color }} title={status}>{style.letter}</span>
}

/** Hover-reveal button copying `path`'s workspace-relative form to the clipboard, with a brief check-mark confirmation. */
function CopyPathButton({ path, rootPath, t }: { path: string; rootPath: string; t: Translate<WorkspaceTreeKey> }): ReactNode {
  const [copied, setCopied] = useState(false)
  const label = copied ? t('copied') : t('copyPath')
  return (
    <button
      type="button"
      className={css.openButton}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        if (copied) return
        void writeClipboard(relativeTo(path, rootPath)).then((ok) => {
          if (!ok) return
          setCopied(true)
          window.setTimeout(() => { setCopied(false) }, 1000)
        })
      }}
    >
      {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
    </button>
  )
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
  const dimmed = isIgnored(entry.path, controls.ignoredPaths)

  useEffect(() => { setOpen(false) }, [controls.collapseKey])

  return (
    <DisclosureRow
      icon={open ? <IconFolderOpen16 /> : <IconFolderClose16 />}
      title={entry.name}
      open={open}
      expandable
      expandOnRowClick
      keepContentWhenOpen
      rowClassName={dimmed ? css.dimmed : undefined}
      collapsedContent={(
        <span className={css.actions}>
          <CopyPathButton path={entry.path} rootPath={controls.rootPath} t={controls.t} />
          <button
            type="button"
            className={css.openButton}
            aria-label={controls.t('openFolder', { name: entry.name })}
            title={controls.t('openFolder', { name: entry.name })}
            onClick={(e) => { e.stopPropagation(); controls.openPath(entry.path) }}
          >
            <IconRightUpOutline14 />
          </button>
        </span>
      )}
      onToggle={() => { setOpen(current => !current) }}
    >
      <div className={css.children}>
        <LevelBody state={state} controls={controls} />
      </div>
    </DisclosureRow>
  )
}

/** One file row; a click (or Enter/Space) opens it with the OS default app. */
function FileRow({ entry, controls }: { entry: WorkspaceEntry; controls: TreeControls }): ReactNode {
  const dimmed = isIgnored(entry.path, controls.ignoredPaths)
  const status = controls.gitStatusByPath.get(entry.path)
  const onOpen = (): void => { controls.openPath(entry.path) }
  return (
    <div
      className={clsx(css.fileRow, dimmed && css.dimmed)}
      data-tree-row
      role="button"
      tabIndex={0}
      title={controls.t('openFile', { name: entry.name })}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      <FileTypeIcon name={entry.name} className={css.fileIcon} />
      <span className={css.fileName}>{entry.name}</span>
      <GitStatusBadge status={status} />
      <span className={css.actions}>
        <CopyPathButton path={entry.path} rootPath={controls.rootPath} t={controls.t} />
      </span>
    </div>
  )
}

/** One recursive search match; shows its workspace-relative parent directory and highlights the matched substring. */
function SearchResultRow({ entry, controls, query }: { entry: WorkspaceEntry; controls: TreeControls; query: string }): ReactNode {
  const dir = relativeParent(entry.path, controls.rootPath)
  const dimmed = isIgnored(entry.path, controls.ignoredPaths)
  const status = controls.gitStatusByPath.get(entry.path)
  const onOpen = (): void => { controls.openPath(entry.path) }
  return (
    <div
      className={clsx(css.fileRow, dimmed && css.dimmed)}
      data-tree-row
      role="button"
      tabIndex={0}
      title={entry.kind === 'directory' ? controls.t('openFolder', { name: entry.name }) : controls.t('openFile', { name: entry.name })}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      {entry.kind === 'directory' ? <IconFolderClose16 className={css.fileIcon} /> : <FileTypeIcon name={entry.name} className={css.fileIcon} />}
      <span className={css.fileName}>{highlightMatch(entry.name, query)}</span>
      <GitStatusBadge status={status} />
      {dir !== '' && <span className={css.searchResultDir}>{dir}</span>}
      <span className={css.actions}>
        <CopyPathButton path={entry.path} rootPath={controls.rootPath} t={controls.t} />
      </span>
    </div>
  )
}

/** The filter box's recursive-search results view: loading/error/empty, the flat match list, or a truncation note. */
function SearchResults({ state, controls, query }: { state: SearchState; controls: TreeControls; query: string }): ReactNode {
  if (state.status === 'idle' || state.status === 'loading') return <div className={css.status}>{controls.t('searching')}</div>
  if (state.status === 'error') return <div className={css.status}>{state.message}</div>
  const results = visibleEntries(state.results, controls)
  if (results.length === 0) return <div className={css.status}>{controls.t('noMatch')}</div>
  return (
    <>
      {results.map(entry => <SearchResultRow key={entry.path} entry={entry} controls={controls} query={query} />)}
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
  rootPath, listWorkspaceEntries, searchWorkspaceEntries, gitStatus, openPath, onOpen, onClose, t,
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

  const gitStatusData = useGitStatus(rootPath, reloadKey, gitStatus)

  const controls = useMemo<TreeControls>(() => ({
    listWorkspaceEntries,
    openPath: tryOpen,
    t,
    rootPath: rootPath ?? '',
    showHidden,
    reloadKey,
    collapseKey,
    gitStatusByPath: gitStatusData.byPath,
    ignoredPaths: gitStatusData.ignored,
  }), [listWorkspaceEntries, tryOpen, t, rootPath, showHidden, reloadKey, collapseKey, gitStatusData])

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

      <div className={css.body} onKeyDown={handleTreeKeyDown}>
        {rootPath === undefined
          ? <div className={css.status}>{t('noWorkspace')}</div>
          : searching
            ? <SearchResults state={search} controls={controls} query={filter} />
            : <LevelBody state={root} controls={controls} />}
      </div>
    </div>
  )
}
