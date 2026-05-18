// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
// Curated list of HF GGUF models for the catalog page.
// Mirror of curated-models.json. Kept as TS so it ships into dist/ on tsc build.
// To edit: update both files (or remove the json once we're sure nothing reads it).

export interface CuratedSpec {
  sections: Array<{
    key: string;
    label: string;
    default_quant: string;
    models: string[];
  }>;
}

export const CURATED_MODELS: CuratedSpec = {
  sections: [
    {
      key: 'code',
      label: 'Code',
      default_quant: 'Q4_K_M',
      models: [
        'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
        'bartowski/Qwen2.5-Coder-32B-Instruct-GGUF',
        'bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF',
      ],
    },
    {
      key: 'chat',
      label: 'Chat / General',
      default_quant: 'Q4_K_M',
      models: [
        'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
        'bartowski/Llama-3.2-3B-Instruct-GGUF',
        'MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF',
      ],
    },
    {
      key: 'reasoning',
      label: 'Reasoning',
      default_quant: 'Q4_K_M',
      models: [
        'bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF',
        'bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF',
      ],
    },
  ],
};
