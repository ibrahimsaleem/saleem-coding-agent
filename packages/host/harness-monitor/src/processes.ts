/**
 * Windows process scan for running harness CLI instances, and the force-kill
 * used by the reactive kill switch. Reads full command lines via
 * `Get-CimInstance Win32_Process` (Toolhelp32 alone does not carry argv, which
 * the profile match needs), invoked through the shared no-shell `execFile`
 * runner. Non-Windows platforms report no processes (the CLI's `web` profile
 * is Windows-hosted in this deployment).
 * @module @deepseek-ai/dsh-host-harness-monitor/processes
 */

import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import type { MonitorKillResult, MonitorProcess } from './types.ts'

/**
 * A process command line names a harness CLI launch when it runs the installed
 * `saleem` package's entry, a `saleem` binary shim, or the in-repo CLI entry
 * (`apps/cli/lib/bin.js`, how a local dev build is launched). The monitor's own
 * host process is tagged (`self`) rather than filtered, so the kill switch can
 * decide about it explicitly.
 */
const HARNESS_CMD_RE = new RegExp([
  /saleem-harness-cli[\\/]lib[\\/]bin\.js/,
  /apps[\\/]cli[\\/]lib[\\/]bin\.js/,
  /[\\/]saleem(?:\.cmd|\.ps1)?["']?\s/,
  /[\\/]\.bin[\\/]saleem\b/,
].map(part => part.source).join('|'), 'i')

/** Extract a profile name from a CLI command line, else `unknown`. */
function profileOf(cmd: string): string {
  const flagged = cmd.match(/--profile[= ]("?)([\w-]+)\1/)
  if (flagged !== null) return flagged[2] ?? 'unknown'
  const positional = cmd.match(/\bbin\.js"?\s+(\w+)/)
  if (positional !== null && positional[1] !== undefined) return positional[1]
  if (/\bweb\b/.test(cmd)) return 'web'
  return 'unknown'
}

/** One row of the PowerShell process query. */
interface RawProc {
  ProcessId?: number
  CommandLine?: string | null
  CreationDate?: string | null
}

/**
 * Enumerate running harness CLI processes.
 * @param selfPid - this host process's pid, tagged on the matching row.
 * @param signal - lifetime for the scan; abort ends the child.
 * @param run - command runner (injectable for tests).
 * @returns the detected processes, most-recently-started first.
 */
export async function listHarnessProcesses(
  selfPid: number,
  signal: AbortSignal,
  run: NativeCommandRunner = runNativeCommand,
): Promise<MonitorProcess[]> {
  if (process.platform !== 'win32') return []
  let stdout: string
  try {
    ({ stdout } = await run('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress",
    ], signal))
  } catch {
    return []
  }
  let list: RawProc[]
  try {
    const parsed: unknown = JSON.parse(stdout.trim() || 'null')
    list = parsed === null ? [] : Array.isArray(parsed) ? parsed as RawProc[] : [parsed as RawProc]
  } catch {
    return []
  }

  const results: MonitorProcess[] = []
  for (const proc of list) {
    const cmd = proc.CommandLine ?? ''
    const pid = proc.ProcessId
    if (typeof pid !== 'number' || !HARNESS_CMD_RE.test(cmd)) continue
    results.push({
      pid,
      profile: profileOf(cmd),
      commandLine: cmd,
      creationDate: proc.CreationDate ?? null,
      self: pid === selfPid,
    })
  }
  results.sort((a, b) => (b.creationDate ?? '').localeCompare(a.creationDate ?? ''))
  return results
}

/**
 * Force-kill one process.
 * @param pid - target pid.
 * @param signal - lifetime for the kill command.
 * @param run - command runner (injectable for tests).
 * @returns the outcome (never throws).
 */
export async function killProcess(
  pid: number,
  signal: AbortSignal,
  run: NativeCommandRunner = runNativeCommand,
): Promise<MonitorKillResult> {
  try {
    await run('taskkill', ['/PID', String(pid), '/T', '/F'], signal)
    return { pid, ok: true }
  } catch (error) {
    return { pid, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Force-kill every detected harness process — including this one.
 *
 * The monitor runs inside the harness process it observes, so there is no
 * "outside" to stand on: excluding self would blind the switch in the common
 * single-instance case (a malicious pattern in the very process hosting the
 * panel). Killing self ends the current session; that is the intended
 * circuit-breaker behavior.
 * @param selfPid - this host process's pid (killed last).
 * @param signal - lifetime for the scan and kills.
 * @param run - command runner (injectable for tests).
 * @returns one result per targeted pid.
 */
export async function killAllHarnessProcesses(
  selfPid: number,
  signal: AbortSignal,
  run: NativeCommandRunner = runNativeCommand,
): Promise<MonitorKillResult[]> {
  const procs = await listHarnessProcesses(selfPid, signal, run)
  const others = procs.filter(p => !p.self).map(p => p.pid)
  const results: MonitorKillResult[] = []
  for (const pid of others) results.push(await killProcess(pid, signal, run))
  if (procs.some(p => p.self)) results.push(await killProcess(selfPid, signal, run))
  return results
}
