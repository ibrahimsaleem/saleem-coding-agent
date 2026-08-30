/**
 * Heuristic security scanner: a fixed rule set of regexes run over prompt text
 * and tool-call arguments. Pattern-matching only — it flags shapes that are
 * almost always malicious in an agentic dev context, and is explicitly not a
 * substitute for a sandbox or an approval policy. The `autoKill` rules are the
 * short high-confidence subset an armed kill switch acts on.
 * @module @deepseek-ai/dsh-host-harness-monitor/security
 */

/** One scanner rule. */
export interface SecurityRule {
  id: string
  severity: 'high' | 'medium' | 'low'
  /** Whether an armed guard force-kills the harness when this fires on a fresh event. */
  autoKill: boolean
  label: string
  re: RegExp
}

/** Severity sort weight (higher = shown first). */
export const SEVERITY_RANK: Record<SecurityRule['severity'], number> = { high: 3, medium: 2, low: 1 }

/** `rm` with a bundled recursive-force flag (`-rf`, `-fr`, `-Rf`, …). */
const RM_RF = /\brm\s+-[a-z]*r[a-z]*f[a-z]*\b/
/** `Remove-Item` where `-Recurse` and `-Force` both appear anywhere ahead. */
const REMOVE_ITEM_REC = /\bRemove-Item\b(?=[^\n]*?-Recurse)(?=[^\n]*?-Force)/
/** One Windows path segment (no separator / quote / newline). */
const WIN_SEG = /[^\\/"\n]+/
/** Personal folders whose direct children a wide delete is never routine cleanup of. */
const WIN_PERSONAL = /Downloads|Desktop|Documents|OneDrive/
/** Trailing separators plus the quote / whitespace / end boundary. */
const WIN_TAIL = /\\{0,2}(?=["'\s]|$)/
/** A Windows delete target: a drive root, a user profile, or one dir under a personal folder. */
const WIN_TARGET = new RegExp(
  /[^\n]*?[A-Za-z]:\\{1,2}/.source
  + '(?:Users\\\\{1,2}' + WIN_SEG.source
  + '(?:\\\\{1,2}(?:' + WIN_PERSONAL.source + ')\\\\{1,2}' + WIN_SEG.source + ')?)?'
  + WIN_TAIL.source,
)

/**
 * A recursive force-delete whose target is a filesystem root, a home directory,
 * or a project directly under a user profile / Downloads / Desktop / Documents
 * / OneDrive — never a legitimate agent cleanup (those use relative paths:
 * `rm -rf node_modules`, `Remove-Item -Recurse -Force ./dist`).
 */
const WIDE_DELETE_RE = new RegExp([
  // unix: `rm -rf` targeting a bare filesystem root or a whole home directory
  RM_RF.source + /[^\n]*?["'\s](?:\/|~\/?|\$HOME|\/(?:home|Users)\/[^\s"/]+\/?)["']?(?=\s|[;&|"']|$)/.source,
  // windows: a recursive Remove-Item (or `rm -rf`) hitting a wide target
  '(?:' + REMOVE_ITEM_REC.source + '|' + RM_RF.source + ')' + WIN_TARGET.source,
].join('|'), 'i')

/**
 * The rule set. Order is not significant (every rule is tested against every
 * scanned string); `SEVERITY_RANK` drives display ordering.
 */
export const RULES: readonly SecurityRule[] = [
  { id: 'destructive-fs', severity: 'high', autoKill: false, label: 'Destructive filesystem wipe', re: /\brm\s+-[a-z]*r[a-z]*f|\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force|del\s+\/[fsq]{1,3}\s|format\s+[a-z]:/i },
  // Auto-kill, unlike the broad `destructive-fs` flag above. See WIDE_DELETE_RE.
  {
    id: 'wide-recursive-delete',
    severity: 'high',
    autoKill: true,
    label: 'Recursive delete of a home / project / drive-root directory',
    re: WIDE_DELETE_RE,
  },
  { id: 'fork-bomb', severity: 'high', autoKill: true, label: 'Fork bomb pattern', re: /:\(\)\s*\{\s*:\|:&\s*\};:/ },
  { id: 'pipe-to-shell', severity: 'high', autoKill: true, label: 'Remote script piped directly to a shell', re: /(curl|wget|iwr|Invoke-WebRequest)[^\n|]*\|\s*(sh|bash|iex|Invoke-Expression|powershell)/i },
  { id: 'invoke-expression', severity: 'medium', autoKill: false, label: 'Dynamic code execution (Invoke-Expression/eval)', re: /\bInvoke-Expression\b|\biex\s|(^|[^.\w])eval\s*\(/i },
  { id: 'disable-defenses', severity: 'high', autoKill: true, label: 'Disabling security tooling', re: /Set-MpPreference\s+-DisableRealtimeMonitoring|DisableAntiSpyware|netsh\s+advfirewall\s+set[^\n]*off|Disable-WindowsOptionalFeature/i },
  { id: 'credential-dump', severity: 'high', autoKill: true, label: 'Credential dumping tool', re: /mimikatz|Invoke-Mimikatz|lsass\.dmp|procdump[^\n]*lsass/i },
  { id: 'persistence', severity: 'medium', autoKill: false, label: 'Persistence mechanism (scheduled task / run key)', re: /schtasks\s+\/create|reg\s+add[^\n]*\\Run\b|New-ScheduledTask/i },
  { id: 'secret-literal', severity: 'medium', autoKill: false, label: 'Possible secret/API key literal', re: /\bsk-[a-zA-Z0-9]{16,}\b|\bAKIA[0-9A-Z]{12,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'reverse-shell', severity: 'high', autoKill: true, label: 'Reverse shell / raw socket listener', re: /nc\s+-e\s|\/dev\/tcp\/|New-Object\s+System\.Net\.Sockets\.TCPClient/i },
  { id: 'exfil', severity: 'medium', autoKill: false, label: 'Possible data exfiltration via network tool', re: /curl[^\n]*--upload-file|Invoke-WebRequest[^\n]*-Method\s+Post[^\n]*-InFile/i },
  { id: 'kill-process', severity: 'low', autoKill: false, label: 'Force-killing processes', re: /taskkill\s+\/f|Stop-Process[^\n]*-Force/i },
  { id: 'shutdown', severity: 'medium', autoKill: false, label: 'System shutdown/restart', re: /shutdown\s+\/[sr]\b|Restart-Computer|Stop-Computer/i },
  { id: 'shadow-copy-deletion', severity: 'high', autoKill: true, label: 'Shadow-copy/backup deletion (ransomware signature)', re: /vssadmin\s+delete\s+shadows|wmic\s+shadowcopy\s+delete|Get-WmiObject\s+Win32_ShadowCopy[^\n]*Remove/i },
  { id: 'log-clearing', severity: 'high', autoKill: true, label: 'Clearing system/security event logs (anti-forensics)', re: /wevtutil\s+cl\s|Clear-EventLog\b|Remove-EventLog\b/i },
  { id: 'raw-disk-wipe', severity: 'high', autoKill: true, label: 'Writing directly to a raw disk device', re: /dd\s+[^\n]*of=\/dev\/(sd|nvme|hd|vd)[a-z]/i },
  { id: 'system-drive-format', severity: 'high', autoKill: true, label: 'Formatting the system drive', re: /\bformat\s+c:\s*(\/|\s|$)/i },
]

/** Short display labels of the auto-kill rules, for the arm-confirmation copy. */
export const AUTOKILL_LABELS: readonly string[] = RULES.filter(r => r.autoKill).map(r => r.label)

/** One scanner hit. */
export interface SecurityHit {
  ruleId: string
  severity: SecurityRule['severity']
  autoKill: boolean
  label: string
  snippet: string
}

/**
 * Scan one text blob against every rule.
 * @param text - prompt text or a tool call's raw `arguments` string.
 * @returns one hit per matching rule (a single blob can match several).
 */
export function scanText(text: unknown): SecurityHit[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const hits: SecurityHit[] = []
  for (const rule of RULES) {
    const m = text.match(rule.re)
    if (m === null || m.index === undefined) continue
    const start = Math.max(0, m.index - 40)
    const end = m.index + m[0].length + 40
    hits.push({
      ruleId: rule.id,
      severity: rule.severity,
      autoKill: rule.autoKill,
      label: rule.label,
      snippet: text.slice(start, end).trim(),
    })
  }
  return hits
}
