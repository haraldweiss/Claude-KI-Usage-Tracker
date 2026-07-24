export interface ScraperConfig {
  /** Human-readable label (e.g. "Claude.ai", "Anthropic Console") */
  label: string;
  /** Backend source type (matches SourceType in backend) */
  source: string;
  /** Login URL for initial auth */
  loginUrl: string;
  /** Cookie storage key (filename without extension) */
  cookieKey: string;
  /** Run interval in minutes (default: 15) */
  intervalMin?: number;
}

export interface ScraperResult {
  success: boolean;
  source: string;
  posted?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export interface UsageTrackPayload {
  model: string;
  input_tokens: number;
  output_tokens: number;
  source: string;
  conversation_id: string;
  workspace?: string;
  response_metadata?: Record<string, unknown>;
  cost_usd?: number;
}

/** Registry of all scrapers with their config */
export const SCRAPER_REGISTRY: Record<string, ScraperConfig> = {
  claude_ai: {
    label: 'Claude.ai',
    source: 'claude_official_sync',
    loginUrl: 'https://claude.ai/login',
    cookieKey: 'claude-ai',
  },
  console: {
    label: 'Anthropic Console',
    source: 'anthropic_console_sync',
    loginUrl: 'https://platform.claude.com/login',
    cookieKey: 'anthropic-console',
  },
  claude_code: {
    label: 'Claude Code',
    source: 'claude_code_sync',
    loginUrl: 'https://platform.claude.com/login',
    cookieKey: 'claude-code',
  },
  opencode_go: {
    label: 'OpenCode Go',
    source: 'opencode_go_sync',
    loginUrl: 'https://opencode.ai/login',
    cookieKey: 'opencode-go',
  },
  zai: {
    label: 'z.ai',
    source: 'zai_sync',
    loginUrl: 'https://z.ai/login',
    cookieKey: 'zai',
  },
  opencode_api: {
    label: 'OpenCode API',
    source: 'opencode_api_usage_sync',
    loginUrl: 'https://opencode.ai/login',
    cookieKey: 'opencode-api',
  },
  codex: {
    label: 'Codex',
    source: 'codex_sync',
    loginUrl: 'https://chatgpt.com/login',
    cookieKey: 'codex',
  },
  openai_api: {
    label: 'OpenAI API',
    source: 'openai_api_sync',
    loginUrl: 'https://platform.openai.com/login',
    cookieKey: 'openai-api',
  },
  openrouter: {
    label: 'OpenRouter',
    source: 'openrouter_sync',
    loginUrl: 'https://openrouter.ai/workspaces/default',
    cookieKey: 'openrouter',
  },
};

/** Scrapers that share the same auth domain */
export const AUTH_SHARED: Record<string, string[]> = {
  'platform.claude.com': ['console', 'claude_code'],
  'opencode.ai': ['opencode_go', 'opencode_api'],
};
