/**
 * The shipped free-platform catalog (data as of 2026-08). Limits and rosters
 * shift; a user can override rank/limits per candidate in settings, and
 * OpenRouter free models can be discovered live. Kept deliberately small and
 * biased toward tool-capable coding models.
 * @module @ibrahimsaleem/dsh-llm-free-model-router/catalog/platforms
 */

import type { FreePlatform } from './types.ts'

/** Every free platform this router knows how to configure. */
export const FREE_PLATFORMS: readonly FreePlatform[] = [
  {
    id: 'google',
    displayName: 'Google AI Studio (Gemini free)',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    api: 'openai-completions',
    isPiAiBuiltin: true,
    apiKeyRefBase: 'GOOGLE_API_KEY',
    dailyResetZone: 'america/los_angeles',
    maxKeys: 3,
    models: [
      { id: 'gemini-3-flash', displayName: 'Gemini 3 Flash', contextWindow: 1_048_576, maxTokens: 65_536, codingRank: 10, toolCapable: true, reasoning: true, rpm: 10, rpd: 1500, tpm: 250_000 },
      { id: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', contextWindow: 1_048_576, maxTokens: 65_536, codingRank: 40, toolCapable: true, reasoning: false, rpm: 15, rpd: 1500, tpm: 250_000 },
    ],
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter (free)',
    baseURL: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    isPiAiBuiltin: false,
    apiKeyRefBase: 'OPENROUTER_API_KEY',
    dailyResetZone: 'utc',
    maxKeys: 3,
    models: [
      { id: 'z-ai/glm-4.7:free', displayName: 'GLM-4.7 (free)', contextWindow: 131_072, maxTokens: 32_768, codingRank: 20, toolCapable: true, reasoning: false, rpm: 20, rpd: 50 },
      { id: 'qwen/qwen3-coder:free', displayName: 'Qwen3 Coder (free)', contextWindow: 262_144, maxTokens: 32_768, codingRank: 22, toolCapable: true, reasoning: false, rpm: 20, rpd: 50 },
      { id: 'deepseek/deepseek-chat-v3.1:free', displayName: 'DeepSeek Chat (free)', contextWindow: 163_840, maxTokens: 32_768, codingRank: 35, toolCapable: true, reasoning: false, rpm: 20, rpd: 50 },
    ],
  },
  {
    id: 'groq',
    displayName: 'Groq (free)',
    baseURL: 'https://api.groq.com/openai/v1',
    api: 'openai-completions',
    isPiAiBuiltin: true,
    apiKeyRefBase: 'GROQ_API_KEY',
    orgLevelLimits: true,
    dailyResetZone: 'utc',
    maxKeys: 1,
    models: [
      { id: 'openai/gpt-oss-120b', displayName: 'GPT-OSS 120B (Groq)', contextWindow: 131_072, maxTokens: 32_768, codingRank: 30, toolCapable: true, reasoning: false, rpm: 30, rpd: 1000, tpm: 30_000 },
      { id: 'qwen/qwen3-32b', displayName: 'Qwen3 32B (Groq)', contextWindow: 131_072, maxTokens: 32_768, codingRank: 45, toolCapable: true, reasoning: false, rpm: 30, rpd: 1000, tpm: 6000 },
    ],
  },
  {
    id: 'cerebras',
    displayName: 'Cerebras (free)',
    baseURL: 'https://api.cerebras.ai/v1',
    api: 'openai-completions',
    isPiAiBuiltin: false,
    apiKeyRefBase: 'CEREBRAS_API_KEY',
    dailyResetZone: 'utc',
    maxKeys: 3,
    models: [
      { id: 'gpt-oss-120b', displayName: 'GPT-OSS 120B (Cerebras)', contextWindow: 65_536, maxTokens: 32_768, codingRank: 32, toolCapable: true, reasoning: false, rpm: 30, tpd: 1_000_000 },
      { id: 'qwen-3-coder-480b', displayName: 'Qwen3 Coder 480B (Cerebras)', contextWindow: 131_072, maxTokens: 32_768, codingRank: 24, toolCapable: true, reasoning: false, rpm: 30, tpd: 1_000_000 },
    ],
  },
  {
    id: 'nvidia',
    displayName: 'NVIDIA NIM (free)',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    api: 'openai-completions',
    isPiAiBuiltin: false,
    apiKeyRefBase: 'NVIDIA_API_KEY',
    dailyResetZone: 'unknown',
    maxKeys: 3,
    models: [
      { id: 'qwen/qwen3-coder-480b-a35b-instruct', displayName: 'Qwen3 Coder 480B (NVIDIA)', contextWindow: 262_144, maxTokens: 32_768, codingRank: 26, toolCapable: true, reasoning: false, rpm: 40 },
      { id: 'deepseek-ai/deepseek-v3.1', displayName: 'DeepSeek V3.1 (NVIDIA)', contextWindow: 163_840, maxTokens: 32_768, codingRank: 34, toolCapable: true, reasoning: false, rpm: 40 },
    ],
  },
  {
    id: 'mistral',
    displayName: 'Mistral (free)',
    baseURL: 'https://api.mistral.ai/v1',
    api: 'openai-completions',
    isPiAiBuiltin: false,
    apiKeyRefBase: 'MISTRAL_API_KEY',
    dailyResetZone: 'utc',
    maxKeys: 3,
    models: [
      { id: 'codestral-latest', displayName: 'Codestral (free)', contextWindow: 262_144, maxTokens: 32_768, codingRank: 38, toolCapable: true, reasoning: false, rpm: 30 },
      { id: 'mistral-large-latest', displayName: 'Mistral Large (free)', contextWindow: 131_072, maxTokens: 32_768, codingRank: 42, toolCapable: true, reasoning: false, rpm: 30 },
    ],
  },
  {
    id: 'ollama-cloud',
    displayName: 'Ollama Cloud (free)',
    baseURL: 'https://ollama.com/v1',
    api: 'openai-completions',
    isPiAiBuiltin: false,
    apiKeyRefBase: 'OLLAMA_API_KEY',
    dailyResetZone: 'unknown',
    maxKeys: 1,
    models: [
      { id: 'qwen3-coder:480b-cloud', displayName: 'Qwen3 Coder 480B (Ollama Cloud)', contextWindow: 262_144, maxTokens: 32_768, codingRank: 28, toolCapable: true, reasoning: false },
      { id: 'gpt-oss:120b-cloud', displayName: 'GPT-OSS 120B (Ollama Cloud)', contextWindow: 131_072, maxTokens: 32_768, codingRank: 33, toolCapable: true, reasoning: false },
    ],
  },
  {
    id: 'ollama-local',
    displayName: 'Ollama (local)',
    baseURL: 'http://localhost:11434/v1',
    api: 'openai-completions',
    isPiAiBuiltin: false,
    authless: true,
    dailyResetZone: 'unknown',
    maxKeys: 1,
    models: [
      { id: 'qwen2.5-coder:7b', displayName: 'Qwen2.5 Coder 7B (local)', contextWindow: 32_768, maxTokens: 8192, codingRank: 88, toolCapable: true, reasoning: false },
      { id: 'qwen3-coder:30b', displayName: 'Qwen3 Coder 30B (local)', contextWindow: 262_144, maxTokens: 16_384, codingRank: 70, toolCapable: true, reasoning: false },
    ],
  },
] as const

/** Look up a shipped platform by id. */
export function findPlatform(id: string): FreePlatform | undefined {
  return FREE_PLATFORMS.find(platform => platform.id === id)
}

/** The catalog id of the always-available local fallback platform. */
export const LOCAL_FALLBACK_PLATFORM_ID = 'ollama-local'
