/**
 * Preventive tool-call guard for Saleem Harness.
 *
 * Registers a synchronous `ctx.tools.guard()` callback, evaluated after
 * `tools/pre-execute` and before the tool body dispatches (see
 * `@deepseek-ai/dsh-tools`) — a match here denies the call before it ever
 * executes, receiving the actual parsed `exec.arguments`. This is a
 * materially stronger guarantee than an approval-seam answerer (which only
 * ever sees a tool's name, never its arguments) or an external log-watching
 * kill switch (which can only react after the call was already logged).
 *
 * Scope is deliberately narrow: patterns with essentially zero legitimate
 * use in normal agentic dev work, so auto-denial doesn't produce constant
 * false positives on routine commands (`rm -rf node_modules`, killing a
 * stuck dev server, etc. are intentionally NOT covered here).
 *
 * @module @ibrahimsaleem/dsh-guard-tool-safety
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, ToolGuard } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-guard-saleem'

/** The tool registry service this plugin registers a guard on. */
export const inject = ['tools']

interface Rule {
  id: string
  label: string
  re: RegExp
}

export const RULES: Rule[] = [
  { id: 'fork-bomb', label: 'fork bomb pattern', re: /:\(\)\s*\{\s*:\|:&\s*\};:/ },
  { id: 'pipe-to-shell', label: 'remote script piped directly to a shell', re: /(curl|wget|iwr|Invoke-WebRequest)[^\n|]*\|\s*(sh|bash|iex|Invoke-Expression|powershell)/i },
  { id: 'disable-defenses', label: 'disabling security tooling', re: /Set-MpPreference\s+-DisableRealtimeMonitoring|DisableAntiSpyware|netsh\s+advfirewall\s+set[^\n]*off|Disable-WindowsOptionalFeature/i },
  { id: 'credential-dump', label: 'credential dumping tool', re: /mimikatz|Invoke-Mimikatz|lsass\.dmp|procdump[^\n]*lsass/i },
  { id: 'reverse-shell', label: 'reverse shell / raw socket listener', re: /nc\s+-e\s|\/dev\/tcp\/|New-Object\s+System\.Net\.Sockets\.TCPClient/i },
  { id: 'shadow-copy-deletion', label: 'shadow-copy/backup deletion (ransomware signature)', re: /vssadmin\s+delete\s+shadows|wmic\s+shadowcopy\s+delete|Get-WmiObject\s+Win32_ShadowCopy[^\n]*Remove/i },
  { id: 'log-clearing', label: 'clearing system/security event logs (anti-forensics)', re: /wevtutil\s+cl\s|Clear-EventLog\b|Remove-EventLog\b/i },
  { id: 'raw-disk-wipe', label: 'writing directly to a raw disk device', re: /dd\s+[^\n]*of=\/dev\/(sd|nvme|hd|vd)[a-z]/i },
  { id: 'system-drive-format', label: 'formatting the system drive', re: /\bformat\s+c:\s*(\/|\s|$)/i },
]

/**
 * Synchronous pre-dispatch check. Returns a denial reason on a match,
 * `undefined` to leave the call allowed.
 * @param execution - the identity-protected call after pre-execute policy completed.
 * @returns a denial reason, or `undefined`.
 */
export const checkExecution: ToolGuard = (execution: Readonly<ToolExecution>): string | undefined => {
  let text: string
  try {
    text = JSON.stringify(execution.arguments)
  } catch {
    return undefined // unserializable arguments - nothing to scan
  }
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return `Saleem Harness guard blocked "${execution.name}": matched a high-confidence malicious pattern (${rule.label}). `
        + 'This is a preventive guard, not a judgment call about your intent — if this is a false positive, '
        + 'narrow its rule set in packages/guard/tool-guard-saleem/src/index.ts.'
    }
  }
  return undefined
}

/**
 * Register the guard.
 * @param ctx - Cordis context carrying the tool registry service.
 */
export function apply(ctx: Context): void {
  ctx.tools.guard(checkExecution)
}
