// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
export const pricingFallback = {
  models: [
    // ---- Claude (Anthropic) ----
    {
      api_id: "claude-opus-4-7-20251101",
      displayName: "Claude Opus 4.7",
      tier: "opus",
      inputPrice: 15,
      outputPrice: 75
    },
    {
      api_id: "claude-sonnet-4-6-20250929",
      displayName: "Claude Sonnet 4.6",
      tier: "sonnet",
      inputPrice: 3,
      outputPrice: 15
    },
    {
      api_id: "claude-haiku-4-5-20251001",
      displayName: "Claude Haiku 4.5",
      tier: "haiku",
      inputPrice: 0.8,
      outputPrice: 4
    },
    {
      api_id: "claude-3-7-sonnet-20250219",
      displayName: "Claude 3.7 Sonnet",
      tier: "sonnet",
      inputPrice: 3,
      outputPrice: 15
    },
    {
      api_id: "claude-3-5-sonnet-20241022",
      displayName: "Claude 3.5 Sonnet",
      tier: "sonnet",
      inputPrice: 3,
      outputPrice: 15
    },
    {
      api_id: "claude-3-5-haiku-20241022",
      displayName: "Claude 3.5 Haiku",
      tier: "haiku",
      inputPrice: 0.8,
      outputPrice: 4
    },
    {
      api_id: "claude-3-opus-20240229",
      displayName: "Claude 3 Opus",
      tier: "opus",
      inputPrice: 15,
      outputPrice: 75
    },

    // ---- OpenCode Go (open-source models via opencode.ai subscription) ----
    // Pricing is estimated from the $60/month usage limit divided by
    // documented average request throughput per model. Source:
    // https://opencode.ai/docs/de/go/ — Nutzungslimits table.
    {
      api_id: "opencode-go/glm-5.1",
      displayName: "GLM-5.1 (OpenCode Go)",
      tier: "sonnet",
      inputPrice: 2.5,
      outputPrice: 10
    },
    {
      api_id: "opencode-go/glm-5",
      displayName: "GLM-5 (OpenCode Go)",
      tier: "sonnet",
      inputPrice: 2.0,
      outputPrice: 8
    },
    {
      api_id: "opencode-go/kimi-k2.5",
      displayName: "Kimi K2.5 (OpenCode Go)",
      tier: "sonnet",
      inputPrice: 1.5,
      outputPrice: 6
    },
    {
      api_id: "opencode-go/kimi-k2.6",
      displayName: "Kimi K2.6 (OpenCode Go)",
      tier: "sonnet",
      inputPrice: 2.0,
      outputPrice: 8
    },
    {
      api_id: "opencode-go/mimo-v2.5",
      displayName: "MiMo-V2.5 (OpenCode Go)",
      tier: "haiku",
      inputPrice: 0.5,
      outputPrice: 2
    },
    {
      api_id: "opencode-go/mimo-v2.5-pro",
      displayName: "MiMo-V2.5-Pro (OpenCode Go)",
      tier: "sonnet",
      inputPrice: 1.0,
      outputPrice: 4
    },
    {
      api_id: "opencode-go/minimax-m2.7",
      displayName: "MiniMax M2.7 (OpenCode Go)",
      tier: "haiku",
      inputPrice: 0.4,
      outputPrice: 1.5
    },
    {
      api_id: "opencode-go/minimax-m2.5",
      displayName: "MiniMax M2.5 (OpenCode Go)",
      tier: "haiku",
      inputPrice: 0.2,
      outputPrice: 1.0
    },
    {
      api_id: "opencode-go/qwen3.7-max",
      displayName: "Qwen3.7 Max (OpenCode Go)",
      tier: "sonnet",
      inputPrice: 2.5,
      outputPrice: 10
    },
    {
      api_id: "opencode-go/qwen3.6-plus",
      displayName: "Qwen3.6 Plus (OpenCode Go)",
      tier: "sonnet",
      inputPrice: 1.0,
      outputPrice: 3.5
    },
    {
      api_id: "opencode-go/qwen3.5-plus",
      displayName: "Qwen3.5 Plus (OpenCode Go)",
      tier: "haiku",
      inputPrice: 0.3,
      outputPrice: 1.0
    },
    {
      api_id: "opencode-go/deepseek-v4-pro",
      displayName: "DeepSeek V4 Pro (OpenCode Go)",
      tier: "sonnet",
      inputPrice: 2.0,
      outputPrice: 8
    },
    {
      api_id: "opencode-go/deepseek-v4-flash",
      displayName: "DeepSeek V4 Flash (OpenCode Go)",
      tier: "haiku",
      inputPrice: 0.15,
      outputPrice: 0.6
    },

    // ---- Cline (Subscription API via api.cline.bot) ----
    // Discovered 2026-07-12 via live API probe. Cline Pass = $20/mo subscription.
    // Prices reflect standard retail rates for each model.
    {
      api_id: "cline/anthropic/claude-sonnet-4.5",
      displayName: "Claude Sonnet 4.5 (Cline)",
      tier: "sonnet",
      inputPrice: 3,
      outputPrice: 15
    },
    {
      api_id: "cline/anthropic/claude-sonnet-5",
      displayName: "Claude Sonnet 5 (Cline)",
      tier: "sonnet",
      inputPrice: 2,
      outputPrice: 10
    },
    {
      api_id: "cline/anthropic/claude-opus-4",
      displayName: "Claude Opus 4 (Cline)",
      tier: "opus",
      inputPrice: 5,
      outputPrice: 25
    },
    {
      api_id: "cline/anthropic/claude-opus-4.6",
      displayName: "Claude Opus 4.6 (Cline)",
      tier: "opus",
      inputPrice: 5,
      outputPrice: 25
    },
    {
      api_id: "cline/anthropic/claude-opus-4.7",
      displayName: "Claude Opus 4.7 (Cline)",
      tier: "opus",
      inputPrice: 15,
      outputPrice: 75
    },
    {
      api_id: "cline/anthropic/claude-haiku-4.5",
      displayName: "Claude Haiku 4.5 (Cline)",
      tier: "haiku",
      inputPrice: 0.8,
      outputPrice: 4
    },
    {
      api_id: "cline/google/gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro (Cline)",
      tier: "sonnet",
      inputPrice: 1.25,
      outputPrice: 10
    },
    {
      api_id: "cline/google/gemini-2.5-flash",
      displayName: "Gemini 2.5 Flash (Cline)",
      tier: "haiku",
      inputPrice: 0.15,
      outputPrice: 0.6
    },
    {
      api_id: "cline/deepseek/deepseek-v3",
      displayName: "DeepSeek V3 (Cline)",
      tier: "sonnet",
      inputPrice: 0.27,
      outputPrice: 1.1
    },
    {
      api_id: "cline/deepseek/deepseek-r1",
      displayName: "DeepSeek R1 (Cline)",
      tier: "sonnet",
      inputPrice: 0.55,
      outputPrice: 2.19
    },
    {
      api_id: "cline/openai/gpt-4",
      displayName: "GPT-4 (Cline)",
      tier: "sonnet",
      inputPrice: 2.5,
      outputPrice: 10
    }
  ]
};
