// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
//
// Maps local Ollama models to equivalent cloud models for cost comparison.
// Prices in EUR per 1M tokens (input / output).

export interface CloudEquivalent {
  cloudModel: string;
  displayName: string;
  provider: 'anthropic' | 'opencode' | 'openai';
  inputPrice: number;
  outputPrice: number;
}

const LOCAL_TO_CLOUD: Record<string, CloudEquivalent> = {
  'gemma4:12b': {
    cloudModel: 'claude-sonnet-4-6-20250929',
    displayName: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    inputPrice: 3,
    outputPrice: 15,
  },
  'gemma4:9b': {
    cloudModel: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    provider: 'anthropic',
    inputPrice: 0.8,
    outputPrice: 4,
  },
  'deepseek-r1:8b': {
    cloudModel: 'claude-sonnet-4-6-20250929',
    displayName: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    inputPrice: 3,
    outputPrice: 15,
  },
  'deepseek-r1:7b': {
    cloudModel: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    provider: 'anthropic',
    inputPrice: 0.8,
    outputPrice: 4,
  },
  'deepseek-v4-flash': {
    cloudModel: 'opencode-deepseek-v4-flash',
    displayName: 'OpenCode DeepSeek V4 Flash',
    provider: 'opencode',
    inputPrice: 0.15,
    outputPrice: 0.6,
  },
  'qwen3.6:32b': {
    cloudModel: 'claude-sonnet-4-6-20250929',
    displayName: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    inputPrice: 3,
    outputPrice: 15,
  },
  'llama3.1:8b': {
    cloudModel: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    provider: 'anthropic',
    inputPrice: 0.8,
    outputPrice: 4,
  },
  'mistral-nemo:12b': {
    cloudModel: 'claude-sonnet-4-6-20250929',
    displayName: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    inputPrice: 3,
    outputPrice: 15,
  },
  'nomic-embed-text': {
    cloudModel: 'text-embedding-3-small',
    displayName: 'OpenAI Embedding 3 Small',
    provider: 'openai',
    inputPrice: 0.02,
    outputPrice: 0.02,
  },
};

export function getCloudEquivalent(localModel: string): CloudEquivalent | null {
  const exact = LOCAL_TO_CLOUD[localModel];
  if (exact) return exact;

  const lower = localModel.toLowerCase();
  for (const [key, eq] of Object.entries(LOCAL_TO_CLOUD)) {
    const prefix = key.split(':')[0];
    if (prefix && lower.includes(prefix)) return eq;
    if (key.includes(':') && lower.includes(key)) return eq;
  }

  return null;
}

export const FALLBACK_EQUIVALENT: CloudEquivalent = {
  cloudModel: 'claude-sonnet-4-6-20250929',
  displayName: 'Claude Sonnet 4.6',
  provider: 'anthropic',
  inputPrice: 3,
  outputPrice: 15,
};
