// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MonitorRoot } from '../src/client/MonitorRoot.tsx'
import type { MonitorClient, MonitorSnapshot } from '../src/client/client-face.ts'
import type { HarnessMonitorKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** Identity translator: assertions match on the key names. */
const t = (key: HarnessMonitorKey): string => key

/** A minimal well-formed snapshot with one session and one auto-kill finding. */
function snapshot(overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    generatedAt: Date.now(),
    homeLabel: '~/.dsh',
    summary: {
      sessionCount: 2, runningSessions: 1, processCount: 1, totalTurns: 9, totalPrompts: 4,
      totalToolCalls: 30, totalRetries: 0, totalErrors: 1, modelsConnected: 1,
      securityFindingsCount: 1, riskyPermissionSessions: 1,
      tokens: { input: 100, output: 50, cacheRead: 900, cacheWrite: 0, total: 1050 },
      estimatedCostUsd: 0.0151, hasUnknownCost: false,
    },
    models: [],
    toolCallCounts: { pwsh: 20, read: 10 },
    sessions: [{
      id: 's1', dirName: 's1', workspace: '--ws--', title: 'my session', cwd: 'C:\\work',
      createdAt: 1000, lastActivity: 2000, running: true,
      activity: { kind: 'tool', label: 'pwsh', detail: 'git status', time: 2000 },
      turns: 5, steps: 12, toolCalls: 20, prompts: 3, retries: 0, errors: 0,
      tokenUsage: { input: 100, output: 50, cacheRead: 900, cacheWrite: 0 },
      cost: { knownUsd: 0.0151, unknownShare: 0, byModel: [] },
      permissions: { preset: 'danger-full-access' }, riskyPermission: true,
    }],
    processes: [{ pid: 4242, profile: 'web', commandLine: 'node bin.js web', creationDate: null, self: true }],
    securityFindings: [{
      ruleId: 'wide-recursive-delete', severity: 'high', autoKill: true,
      label: 'Recursive delete of a home / project / drive-root directory',
      snippet: 'Remove-Item -Recurse -Force "C:\\Users\\x\\Downloads\\proj"',
      sessionId: 's1', time: 1500, source: 'tool:pwsh',
    }],
    permissionEvents: [],
    activityTimeline: Array.from({ length: 30 }, (_, i) => ({ t: i, count: i === 29 ? 5 : 0 })),
    history: [],
    guard: { armed: false, armedAt: null, events: [] },
    ...overrides,
  }
}

/** A stub client whose calls the test can observe. */
function stubClient(over: Partial<MonitorClient> = {}): MonitorClient {
  return {
    snapshot: vi.fn(async () => snapshot()),
    sessionTimeline: vi.fn(async () => ({ sessionId: 's1', cwd: null, timeline: [], hasMore: false, oldestSeq: null })),
    setGuardArmed: vi.fn(async armed => ({ armed, armedAt: armed ? 1 : null, events: [] })),
    killNow: vi.fn(async () => []),
    exportCsv: vi.fn(async () => 'id\n'),
    ...over,
  }
}

describe('MonitorRoot', () => {
  it('renders only the trigger until it is clicked', () => {
    render(<MonitorRoot wide client={stubClient()} t={t} />)
    expect(screen.getByRole('button', { name: 'trigger' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the overlay and renders the polled snapshot', async () => {
    const client = stubClient()
    render(<MonitorRoot wide client={client} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    // headline stats from the snapshot
    expect(await screen.findByText('statRunning')).toBeTruthy()
    expect(client.snapshot).toHaveBeenCalled()
  })

  it('switches to the Security tab and shows the auto-kill finding', async () => {
    render(<MonitorRoot wide client={stubClient()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'tabSecurity' }))
    expect(await screen.findByText('Recursive delete of a home / project / drive-root directory')).toBeTruthy()
    expect(screen.getByText('auto-kill')).toBeTruthy()
  })

  it('arms the guard from the Processes tab', async () => {
    const client = stubClient()
    render(<MonitorRoot wide client={client} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'tabProcesses' }))
    fireEvent.click(await screen.findByRole('button', { name: 'guardArm' }))
    await waitFor(() => { expect(client.setGuardArmed).toHaveBeenCalledWith(true) })
  })

  it('closes on Escape', async () => {
    render(<MonitorRoot wide client={stubClient()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
})
