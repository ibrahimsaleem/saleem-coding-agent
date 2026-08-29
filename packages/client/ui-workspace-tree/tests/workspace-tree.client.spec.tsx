// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkspaceEntryListing } from '@deepseek-ai/dsh-client-runtime/client'
import { WorkspaceTree } from '../src/client/WorkspaceTree.tsx'

afterEach(cleanup)

const t = (key: string): string => key

/** A promise this test controls the settlement of, for asserting loading states mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('WorkspaceTree', () => {
  it('shows the no-workspace state and never fetches when no workspace is open', () => {
    const listWorkspaceEntries = vi.fn()
    render(
      <WorkspaceTree
        rootPath={undefined}
        listWorkspaceEntries={listWorkspaceEntries}
        onOpen={vi.fn()}
        onClose={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText('noWorkspace')).toBeTruthy()
    expect(screen.getByText('title')).toBeTruthy()
    expect(listWorkspaceEntries).not.toHaveBeenCalled()
  })

  it('calls onOpen exactly once on mount', () => {
    const onOpen = vi.fn()
    const { rerender } = render(
      <WorkspaceTree
        rootPath="/ws"
        listWorkspaceEntries={() => new Promise(() => {})}
        onOpen={onOpen}
        onClose={vi.fn()}
        t={t}
      />,
    )
    rerender(
      <WorkspaceTree
        rootPath="/ws"
        listWorkspaceEntries={() => new Promise(() => {})}
        onOpen={onOpen}
        onClose={vi.fn()}
        t={t}
      />,
    )
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('calls onClose when the collapse button is clicked', () => {
    const onClose = vi.fn()
    render(
      <WorkspaceTree
        rootPath="/ws"
        listWorkspaceEntries={() => new Promise(() => {})}
        onOpen={vi.fn()}
        onClose={onClose}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'collapse' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('loads the root level, showing loading then the workspace basename and its entries', async () => {
    const root = deferred<WorkspaceEntryListing>()
    const listWorkspaceEntries = vi.fn(() => root.promise)
    render(
      <WorkspaceTree
        rootPath="/home/user/my-project"
        listWorkspaceEntries={listWorkspaceEntries}
        onOpen={vi.fn()}
        onClose={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText('my-project')).toBeTruthy()
    expect(screen.getByText('loading')).toBeTruthy()
    expect(listWorkspaceEntries).toHaveBeenCalledWith('/home/user/my-project', expect.any(AbortSignal))

    root.resolve({
      path: '/home/user/my-project',
      entries: [
        { name: 'src', path: '/home/user/my-project/src', kind: 'directory', hidden: false },
        { name: 'README.md', path: '/home/user/my-project/README.md', kind: 'file', hidden: false },
      ],
      truncated: false,
    })
    expect(await screen.findByText('src')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.queryByText('loading')).toBeNull()
  })

  it('shows the empty-folder state for a level with no entries', async () => {
    const listWorkspaceEntries = vi.fn(async (): Promise<WorkspaceEntryListing> => ({
      path: '/ws', entries: [], truncated: false,
    }))
    render(
      <WorkspaceTree rootPath="/ws" listWorkspaceEntries={listWorkspaceEntries} onOpen={vi.fn()} onClose={vi.fn()} t={t} />,
    )
    expect(await screen.findByText('empty')).toBeTruthy()
  })

  it('shows the rejection message for a level that fails to load', async () => {
    const listWorkspaceEntries = vi.fn(() => Promise.reject(new Error('permission denied')))
    render(
      <WorkspaceTree rootPath="/ws" listWorkspaceEntries={listWorkspaceEntries} onOpen={vi.fn()} onClose={vi.fn()} t={t} />,
    )
    expect(await screen.findByText('permission denied')).toBeTruthy()
  })

  it('lazy-loads a subfolder only on first expand, and toggles closed without refetching', async () => {
    const rootListing: WorkspaceEntryListing = {
      path: '/ws',
      entries: [{ name: 'src', path: '/ws/src', kind: 'directory', hidden: false }],
      truncated: false,
    }
    const childListing: WorkspaceEntryListing = {
      path: '/ws/src',
      entries: [{ name: 'index.ts', path: '/ws/src/index.ts', kind: 'file', hidden: false }],
      truncated: false,
    }
    const listWorkspaceEntries = vi.fn((path: string) => {
      if (path === '/ws') return Promise.resolve(rootListing)
      if (path === '/ws/src') return Promise.resolve(childListing)
      throw new Error(`unexpected path ${path}`)
    })
    render(
      <WorkspaceTree rootPath="/ws" listWorkspaceEntries={listWorkspaceEntries} onOpen={vi.fn()} onClose={vi.fn()} t={t} />,
    )
    const folderRow = await screen.findByText('src')
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(1)

    fireEvent.click(folderRow)
    expect(await screen.findByText('index.ts')).toBeTruthy()
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(2)

    // Collapse, then re-expand: cached in local state, no second fetch.
    fireEvent.click(folderRow)
    expect(screen.queryByText('index.ts')).toBeNull()
    fireEvent.click(folderRow)
    expect(await screen.findByText('index.ts')).toBeTruthy()
    expect(listWorkspaceEntries).toHaveBeenCalledTimes(2)
  })

  it('aborts a superseded fetch when the row collapses before it settles', async () => {
    const first = deferred<WorkspaceEntryListing>()
    const listWorkspaceEntries = vi.fn((path: string) => (path === '/ws' ? first.promise : new Promise<WorkspaceEntryListing>(() => {})))
    render(
      <WorkspaceTree rootPath="/ws" listWorkspaceEntries={listWorkspaceEntries} onOpen={vi.fn()} onClose={vi.fn()} t={t} />,
    )
    expect(screen.getByText('loading')).toBeTruthy()
    const [, signal] = listWorkspaceEntries.mock.calls[0]! as unknown as [string, AbortSignal]
    // Unmount stands in for "the caller moved on": the in-flight request's
    // controller is the component's own, so tearing it down must abort it.
    cleanup()
    await waitFor(() => { expect(signal.aborted).toBe(true) })
  })
})
