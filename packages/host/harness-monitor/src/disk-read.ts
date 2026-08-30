/**
 * Read-only parsers for the two flat `~/.dsh` artifacts the snapshot needs
 * besides the session logs: `settings.yaml` (model/provider inventory) and
 * `storages/session_projcache.json` (per-session token/turn/running-state).
 * Both are best-effort: a missing or malformed file yields an empty result,
 * never an error — the panel degrades to "nothing to show" gracefully.
 * @module @deepseek-ai/dsh-host-harness-monitor/disk-read
 */

import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'

/** One provider/model pair advertised by settings. */
export interface SettingsModel {
  route: string
  id: string
  apiKeyEnv: string | null
}

/**
 * Parse the model/provider inventory from `settings.yaml`. Reads the
 * `llm-pi-ai.providers` map: each provider contributes its declared models,
 * carrying the env var name that holds its key when one is configured.
 * @param path - absolute path to `settings.yaml`.
 * @returns the flattened model list (empty on any failure).
 */
export async function readSettingsModels(path: string): Promise<SettingsModel[]> {
  let doc: unknown
  try {
    doc = parseYaml(await readFile(path, 'utf8'))
  } catch {
    return []
  }
  const providers = pick(pick(doc, 'llm-pi-ai'), 'providers')
  if (providers === undefined || typeof providers !== 'object') return []
  const models: SettingsModel[] = []
  for (const [route, raw] of Object.entries(providers as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object') continue
    const cfg = raw as Record<string, unknown>
    const apiKeyEnv = typeof cfg['apiKeyEnv'] === 'string' ? cfg['apiKeyEnv']
      : typeof cfg['apiKey'] === 'string' && (cfg['apiKey'] as string).startsWith('$')
        ? (cfg['apiKey'] as string).slice(1)
        : null
    const list = Array.isArray(cfg['models']) ? cfg['models'] : []
    if (list.length === 0) {
      models.push({ route, id: '(default)', apiKeyEnv })
      continue
    }
    for (const m of list) {
      const id = typeof m === 'string' ? m
        : m !== null && typeof m === 'object' && typeof (m as { id?: unknown }).id === 'string'
          ? (m as { id: string }).id
          : null
      if (id !== null) models.push({ route, id, apiKeyEnv })
    }
  }
  return models
}

/** One session's cached projection values. */
export interface ProjCacheRow {
  turns: number
  steps: number
  running: boolean
  title: string | null
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

/**
 * Parse `storages/session_projcache.json` into a per-session id → row map.
 * The file is a cache ("possibly stale, never wrong"); a session owned by
 * another live process can lag by that process's write interval.
 * @param path - absolute path to `session_projcache.json`.
 * @returns id → row (empty on any failure).
 */
export async function readProjCache(path: string): Promise<Map<string, ProjCacheRow>> {
  const out = new Map<string, ProjCacheRow>()
  let doc: unknown
  try {
    doc = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return out
  }
  const sessions = pick(pick(doc, 'tables'), 'sessions')
  if (sessions === undefined || typeof sessions !== 'object') return out
  for (const [id, raw] of Object.entries(sessions as Record<string, unknown>)) {
    const rows = pick(raw, 'rows')
    if (rows === undefined || typeof rows !== 'object') continue
    const stats = val(pick(rows, 'sessionStats'))
    const tokenUsage = val(pick(rows, 'tokenUsage'))
    const titleVal = val(pick(rows, 'title'))
    const totals = pick(tokenUsage, 'totals')
    out.set(id, {
      turns: num(pick(stats, 'turns')),
      steps: num(pick(stats, 'steps')),
      // `openStep` is a step number while an agent step is in flight, null otherwise.
      running: typeof pick(stats, 'openStep') === 'number',
      title: typeof titleVal === 'string' ? titleVal : null,
      tokens: {
        input: num(pick(totals, 'uncachedInputTokens')),
        output: num(pick(totals, 'outputTokens')),
        cacheRead: num(pick(totals, 'cacheReadTokens')),
        cacheWrite: num(pick(totals, 'cacheWriteTokens')),
      },
    })
  }
  return out
}

/** Safe property read. */
function pick(obj: unknown, key: string | undefined): unknown {
  if (key === undefined) return obj
  if (obj === null || typeof obj !== 'object') return undefined
  return (obj as Record<string, unknown>)[key]
}

/** The `.val` of a `{ ver, seq, val }` projection row. */
function val(row: unknown): unknown {
  return pick(row, 'val')
}

/** Coerce to a finite number, else 0. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}
