/**
 * Shipped free-platform catalog vocabulary. Pure data — no network, no Cordis.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/catalog/types
 */

/** OpenAI-compatible wire protocol every free platform in the catalog speaks. */
export type FreeWireApi = 'openai-completions'

/** Timezone a platform's daily quota resets in (best-effort). */
export type DailyResetZone = 'utc' | 'america/los_angeles' | 'unknown'

/** How a `poolPolicy` treats one model's reasoning capability. */
export interface FreeModelDescriptor {
  /** Wire model id sent to the provider. */
  id: string
  /** Selector display name; defaults to `id`. */
  displayName?: string
  /** Context capacity, tokens. */
  contextWindow: number
  /** Output token ceiling that also sizes the model. */
  maxTokens: number
  /**
   * Agentic-coding quality rank; lower is better. Used only by this router's
   * {@link selectCandidate}. Rough guide: gemini-3-flash≈10, GLM-4.7/Qwen3-Coder≈20,
   * gpt-oss-120b≈30, gemini-3.1-flash-lite≈40, mid `:free`≈60, local≈90.
   */
  codingRank: number
  /** Whether the model reliably supports tool/function calling. Non-tool models never enter the agentic pool. */
  toolCapable: boolean
  /** Whether the model runs a visible reasoning/thinking pass by default. Prefer non-reasoning models for safe mid-turn switching. */
  reasoning: boolean
  /** Declared free-tier requests per minute, when the platform publishes one. */
  rpm?: number
  /** Declared free-tier requests per day, when the platform publishes one. */
  rpd?: number
  /** Declared free-tier tokens per minute, when the platform publishes one. */
  tpm?: number
  /** Declared free-tier tokens per day, when the platform publishes one. */
  tpd?: number
}

/** One free inference platform and the free coding models it exposes. */
export interface FreePlatform {
  /** Stable catalog id and settings key. */
  id: string
  /** Human-facing name. */
  displayName: string
  /** OpenAI-compatible base URL (`.../v1`). */
  baseURL: string
  /** Wire protocol; always `openai-completions` for the shipped catalog. */
  api: FreeWireApi
  /**
   * `true` when a `llm-pi-ai` builtin catalog route of the same id already
   * exists (Google, Groq): the generated profile inherits its wire details and
   * only supplies `apiKeyEnv` + a narrowed `models` list.
   */
  isPiAiBuiltin: boolean
  /** No API key required (Ollama local). */
  authless?: boolean
  /** Base credential reference; key index `n>1` appends `_${n}`. */
  apiKeyRefBase?: string
  /** Rate limits apply per organization, not per key — extra keys give no headroom (Groq). */
  orgLevelLimits?: boolean
  /** Timezone the daily quota resets in. */
  dailyResetZone: DailyResetZone
  /** Maximum API keys a user may add for this platform (1 for org-level / authless). */
  maxKeys: number
  /** Free coding models exposed by this platform. */
  models: FreeModelDescriptor[]
}
