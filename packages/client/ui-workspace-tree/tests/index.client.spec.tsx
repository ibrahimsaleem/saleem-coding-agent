// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceEntryListing } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

afterEach(cleanup)

const listing: WorkspaceEntryListing = {
  path: '/ws',
  entries: [{ name: 'src', path: '/ws/src', kind: 'directory', hidden: false }],
  truncated: false,
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const listWorkspaceEntries = vi.fn(async (): Promise<WorkspaceEntryListing> => listing)
  const openTree = vi.fn()
  const closeTree = vi.fn()
  ctx.provide('workspaces', { listWorkspaceEntries } as never)
  ctx.provide('layout', { openTree, closeTree } as never)
  const slots = ctx.get('slots') as SlotRegistry
  // The plugin's ctx.slots.inject('workspaceTree', ...) only fires once some
  // registration declares that child slot — in production, ui-layout's
  // AppFrame; here, a minimal stand-in root registration.
  const declare = () => slots.register({
    name: 'root',
    children: { workspaceTree: { kind: 'single', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots, listWorkspaceEntries, openTree, closeTree, declare }
}

describe('ui-workspace-tree client half', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'workspaces', 'layout', 'locale'])
  })

  it('occupies the workspaceTree slot for declarations before or after apply, and leaves with its fiber', async () => {
    const before = await bench()
    before.declare()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(before.slots.entries('workspaceTree')).toHaveLength(1)
    await fiber.dispose()
    expect(before.slots.entries('workspaceTree')).toHaveLength(0)

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('workspaceTree')).toHaveLength(0)
    after.declare()
    await Promise.resolve()
    expect(after.slots.entries('workspaceTree')).toHaveLength(1)
  })

  it('registers the panel dictionaries and binds this package namespace', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('workspaceTree')[0]!
    const injected = (entry.inject as () => { t: (key: string) => string })()
    // zh is the shipped default locale.
    expect(injected.t('title')).toBe('工作区')
    expect(injected.t('noWorkspace')).toBe('未打开工作区')
    expect(injected.t('collapse')).toBe('收起文件树')
  })

  it('drives the injected wire call and layout actions through the slot entry', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('workspaceTree')[0]!
    const injected = (entry.inject as () => {
      listWorkspaceEntries: (path: string) => Promise<WorkspaceEntryListing>
      onOpen: () => void
      onClose: () => void
    })()
    await expect(injected.listWorkspaceEntries('/ws')).resolves.toBe(listing)
    expect(b.listWorkspaceEntries).toHaveBeenCalledWith('/ws', undefined)
    injected.onOpen()
    expect(b.openTree).toHaveBeenCalledOnce()
    injected.onClose()
    expect(b.closeTree).toHaveBeenCalledOnce()
  })

  it('rolls back the zh dictionary when a rival already owns the namespace en slot', async () => {
    const b = await bench()
    const locale = b.ctx.get('locale') as LocaleRuntime
    const disposeRival = locale.register('workspace-tree', 'en', { title: 'rival' })
    const rejections: unknown[] = []
    const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const fiber = b.ctx.plugin({ inject: [...inject], apply })
      await expect(fiber.await()).rejects.toThrow(/already has locale/)
      disposeRival()
      const disposeZh = locale.register('workspace-tree', 'zh', { title: '空闲' })
      disposeZh()
    } finally {
      await new Promise(resolve => setTimeout(resolve, 0))
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('ui-workspace-tree node half', () => {
  // The invariant companion is mounted by the vitest-wide invariant host on
  // every Context this suite creates; its registration is covered there.
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
