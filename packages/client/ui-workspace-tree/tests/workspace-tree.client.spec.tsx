// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkspaceEntry, WorkspaceEntryListing } from '@deepseek-ai/dsh-client-runtime/client'
import { WorkspaceTree, type WorkspaceTreeProps } from '../src/client/WorkspaceTree.tsx'

afterEach(cleanup)

const t = (key: string, params?: Record<string, string>): string =>
  params === undefined ? key : `${key} ${Object.values(params).join(' ')}`

/** A promise this test controls the settlement of, for asserting loading states mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function entry(name: string, kind: 'file' | 'directory' = 'file', hidden = false): WorkspaceEntry {
  return { name, path: `/ws/${name}`, kind, hidden }
}

function renderTree(props: Partial<WorkspaceTreeProps> = {}) {
  const full: WorkspaceTreeProps = {
    rootPath: '/ws',
    listWorkspaceEntries: () => new Promise<WorkspaceEntryListing>(() => {}),
    openPath: vi.fn(() => Promise.resolve()),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    t: t as WorkspaceTreeProps['t'],
    ...props,
  }
  return { ...render(<WorkspaceTree {...full} />), props: full }
}

describe('WorkspaceTree', () => {
  it('shows the no-workspace state and never fetches when no workspace is open', () => {
    const listWorkspaceEntries = vi.fn()
    renderTree({ rootPath: undefined, listWorkspaceEntries })
    expect(screen.getByText('noWorkspace')).toBeTruthy()
    expect(screen.getByText('title')).toBeTruthy()
    expect(listWorkspaceEntries).not.toHaveBeenCalled()
  })

  it('calls onOpen exactly once on mount', () => {
    const onOpen = vi.fn()
    const { rerender } = renderTree({ onOpen })
    rerender(<WorkspaceTree rootPath="/ws" listWorkspaceEntries={() => new Promise(() => {})} openPath={vi.fn()} onOpen={onOpen} onClose={vi.fn()} t={t as WorkspaceTreeProps['t']} />)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('calls onClose when the collapse button is clicked', () => {
    const onClose = vi.fn()
    renderTree({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'collapse' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('loads the root level, showing loading then the workspace basename and its entries', async () => {
    const root = deferred<WorkspaceEntryListing>()
    const listWorkspaceEntries = vi.fn(() => root.promise)
    renderTree({ rootPath: '/home/user/my-project', listWorkspaceEntries })
    expect(screen.getByText('my-project')).toBeTruthy()
    expect(screen.getByText('loading')).toBeTruthy()
    expect(listWorkspaceEntries).toHaveBeenCalledWith('/home/user/my-project', expect.any(AbortSignal))

    root.resolve({
      path: '/home/user/my-project',
      entries: [entry('src', 'directory'), entry('README.md')],
      truncated: false,
    })
    expect(await screen.findByText('src')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.queryByText('loading')).toBeNull()
  })

  it('shows the empty-folder state for a level with no entries', async () => {
    renderTree({ listWorkspaceEntries: async () => ({ path: '/ws', entries: [], truncated: false }) })
    expect(await screen.findByText('empty')).toBeTruthy()
  })

  it('shows the rejection message for a level that fails to load', async () => {
    renderTree({ listWorkspaceEntries: () => Promise.reject(new Error('permission denied')) })
    expect(await screen.findByText('permission denied')).toBeTruthy()
  })

  it('lazy-loads a subfolder only on first expand, and toggles closed without refetching', async () => {
    const listWorkspaceEntries = vi.fn((path: string) => {
      if (path === '/ws') return Promise.resolve<WorkspaceEntryListing>({ path, entries: [entry('src', 'directory')], truncated: false })
      if (path === '/ws/src') return Promise.resolve<WorkspaceEntryListing>({ path, entries: [entry('index.ts')], truncated: false })
      throw new Error(`unexpected path ${path}`)
    })
    renderTree({ listWorkspaceEntries })
    const folderRow = await screen.findByText('src')
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(1)

    fireEvent.click(folderRow)
    expect(await screen.findByText('index.ts')).toBeTruthy()
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(2)

    fireEvent.click(folderRow)
    expect(screen.queryByText('index.ts')).toBeNull()
    fireEvent.click(folderRow)
    expect(await screen.findByText('index.ts')).toBeTruthy()
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(2)
  })

  it('refetches the root level when rootPath changes under an already-mounted panel (session switch)', async () => {
    const listWorkspaceEntries = vi.fn((path: string) => {
      if (path === '/ws-a') return Promise.resolve<WorkspaceEntryListing>({ path, entries: [{ name: 'a.ts', path: '/ws-a/a.ts', kind: 'file', hidden: false }], truncated: false })
      if (path === '/ws-b') return Promise.resolve<WorkspaceEntryListing>({ path, entries: [{ name: 'b.ts', path: '/ws-b/b.ts', kind: 'file', hidden: false }], truncated: false })
      throw new Error(`unexpected path ${path}`)
    })
    const { rerender } = renderTree({ rootPath: '/ws-a', listWorkspaceEntries })
    expect(await screen.findByText('a.ts')).toBeTruthy()
    rerender(<WorkspaceTree rootPath="/ws-b" listWorkspaceEntries={listWorkspaceEntries} openPath={vi.fn()} onOpen={vi.fn()} onClose={vi.fn()} t={t as WorkspaceTreeProps['t']} />)
    expect(await screen.findByText('b.ts')).toBeTruthy()
    expect(screen.queryByText('a.ts')).toBeNull()
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(2)
  })

  it('aborts a superseded fetch when the row collapses before it settles', async () => {
    const first = deferred<WorkspaceEntryListing>()
    const listWorkspaceEntries = vi.fn((path: string) => (path === '/ws' ? first.promise : new Promise<WorkspaceEntryListing>(() => {})))
    renderTree({ listWorkspaceEntries })
    expect(screen.getByText('loading')).toBeTruthy()
    const [, signal] = listWorkspaceEntries.mock.calls[0]! as unknown as [string, AbortSignal]
    cleanup()
    await waitFor(() => { expect(signal.aborted).toBe(true) })
  })

  // ---- new interactions ----

  it('opens a file with the OS default app on click', async () => {
    const openPath = vi.fn(() => Promise.resolve())
    renderTree({ openPath, listWorkspaceEntries: async () => ({ path: '/ws', entries: [entry('main.py')], truncated: false }) })
    fireEvent.click(await screen.findByText('main.py'))
    expect(openPath).toHaveBeenCalledWith('/ws/main.py')
  })

  it('shows an error banner when opening fails (off-loopback)', async () => {
    const openPath = vi.fn(() => Promise.reject(new Error('native open unavailable')))
    renderTree({ openPath, listWorkspaceEntries: async () => ({ path: '/ws', entries: [entry('main.py')], truncated: false }) })
    fireEvent.click(await screen.findByText('main.py'))
    expect(await screen.findByText('openFailed')).toBeTruthy()
  })

  it('hides dotfiles until the hidden toggle is pressed', async () => {
    renderTree({ listWorkspaceEntries: async () => ({ path: '/ws', entries: [entry('.env', 'file', true), entry('app.ts')], truncated: false }) })
    expect(await screen.findByText('app.ts')).toBeTruthy()
    expect(screen.queryByText('.env')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'toggleHidden' }))
    expect(await screen.findByText('.env')).toBeTruthy()
  })

  it('filters files by name and auto-expands folders while filtering', async () => {
    const listWorkspaceEntries = vi.fn((path: string) => {
      if (path === '/ws') return Promise.resolve<WorkspaceEntryListing>({ path, entries: [entry('src', 'directory'), entry('README.md'), entry('LICENSE')], truncated: false })
      if (path === '/ws/src') return Promise.resolve<WorkspaceEntryListing>({ path, entries: [entry('index.ts'), entry('index.spec.ts')], truncated: false })
      throw new Error(path)
    })
    renderTree({ listWorkspaceEntries })
    await screen.findByText('README.md')
    fireEvent.change(screen.getByPlaceholderText('filter'), { target: { value: 'spec' } })
    // folder auto-expands, matching file shows, non-matching files hidden
    expect(await screen.findByText('index.spec.ts')).toBeTruthy()
    expect(screen.queryByText('README.md')).toBeNull()
    expect(screen.queryByText('index.ts')).toBeNull()
    // clearing restores everything, folder re-collapses
    fireEvent.click(screen.getByRole('button', { name: 'clearFilter' }))
    expect(await screen.findByText('README.md')).toBeTruthy()
    expect(screen.queryByText('index.spec.ts')).toBeNull()
  })

  it('re-collapses every folder on Collapse all', async () => {
    const listWorkspaceEntries = vi.fn((path: string) => {
      if (path === '/ws') return Promise.resolve<WorkspaceEntryListing>({ path, entries: [entry('src', 'directory')], truncated: false })
      if (path === '/ws/src') return Promise.resolve<WorkspaceEntryListing>({ path, entries: [entry('index.ts')], truncated: false })
      throw new Error(path)
    })
    renderTree({ listWorkspaceEntries })
    fireEvent.click(await screen.findByText('src'))
    expect(await screen.findByText('index.ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'collapseAll' }))
    expect(screen.queryByText('index.ts')).toBeNull()
  })

  it('refetches every open level on Refresh', async () => {
    let call = 0
    const listWorkspaceEntries = vi.fn((path: string): Promise<WorkspaceEntryListing> => {
      call += 1
      return Promise.resolve({ path, entries: [entry(`gen-${call}`)], truncated: false })
    })
    renderTree({ listWorkspaceEntries })
    expect(await screen.findByText('gen-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(await screen.findByText('gen-2')).toBeTruthy()
    expect(screen.queryByText('gen-1')).toBeNull()
  })
})
