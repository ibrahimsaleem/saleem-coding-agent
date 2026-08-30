import { describe, expect, it, vi } from 'vitest'
import { estimateSessionCost } from '../src/cost.ts'
import { killAllHarnessProcesses, listHarnessProcesses } from '../src/processes.ts'

describe('cost estimation', () => {
  it('is zero when the session made no requests', () => {
    expect(estimateSessionCost({ input: 100, output: 100, cacheRead: 0, cacheWrite: 0 }, {})).toEqual({
      knownUsd: 0, unknownShare: 0, byModel: [],
    })
  })

  it('marks an unpriced model as unknown, never $0', () => {
    const cost = estimateSessionCost(
      { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      { 'acme/model-x': 4 },
    )
    expect(cost.knownUsd).toBe(0)
    expect(cost.unknownShare).toBe(1)
    expect(cost.byModel[0]?.usd).toBeNull()
  })

  it('splits tokens across models weighted by request share', () => {
    const cost = estimateSessionCost(
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      { 'openrouter/stealth/ox-alpha': 3, 'acme/other': 1 },
    )
    const priced = cost.byModel.find(m => m.key === 'openrouter/stealth/ox-alpha')
    expect(priced?.weight).toBeCloseTo(0.75)
    expect(cost.unknownShare).toBeCloseTo(0.25)
  })
})

describe('process scan', () => {
  const win = process.platform === 'win32'

  it.runIf(!win)('reports no processes off Windows', async () => {
    const run = vi.fn()
    expect(await listHarnessProcesses(1, AbortSignal.timeout(1000), run)).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  it.runIf(win)('keeps only saleem CLI command lines and tags self', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([
        { ProcessId: 100, CommandLine: 'node C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\saleem-harness-cli\\lib\\bin.js web --port 3081', CreationDate: '2026-01-01' },
        { ProcessId: 200, CommandLine: 'node C:\\some\\other\\thing.js', CreationDate: '2026-01-02' },
        { ProcessId: 300, CommandLine: 'node ...\\saleem-harness-cli\\lib\\bin.js --profile web', CreationDate: '2026-01-03' },
      ]),
      stderr: '',
    })
    const procs = await listHarnessProcesses(300, AbortSignal.timeout(1000), run)
    expect(procs.map(p => p.pid).sort()).toEqual([100, 300])
    expect(procs.find(p => p.pid === 300)?.self).toBe(true)
    expect(procs.find(p => p.pid === 100)?.profile).toBe('web')
  })

  it.runIf(win)('kills others first, then self', async () => {
    const calls: string[][] = []
    const run = vi.fn(async (cmd: string, args: readonly string[]) => {
      calls.push([cmd, ...args])
      if (cmd === 'powershell') {
        return {
          stdout: JSON.stringify([
            { ProcessId: 100, CommandLine: '...\\saleem-harness-cli\\lib\\bin.js web' },
            { ProcessId: 999, CommandLine: '...\\saleem-harness-cli\\lib\\bin.js web' },
          ]),
          stderr: '',
        }
      }
      return { stdout: '', stderr: '' }
    })
    const results = await killAllHarnessProcesses(999, AbortSignal.timeout(1000), run)
    expect(results.map(r => r.pid)).toEqual([100, 999])
    const killArgs = calls.filter(c => c[0] === 'taskkill').map(c => c[2])
    expect(killArgs).toEqual(['100', '999'])
  })
})
