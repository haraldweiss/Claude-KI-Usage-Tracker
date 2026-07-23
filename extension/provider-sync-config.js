// © 2026 Harald Weiss
// Shared, side-effect-free provider activation rules for the extension.
// A non-empty plan_name is the user's explicit opt-in. "API Usage" is a
// zero-cost plan marker and therefore activates a pay-as-you-go provider.

(function exposeProviderSyncConfig(root) {
  const PROVIDER_COOKIE_DOMAINS = {
    claude_ai: ['claude.ai', 'www.claude.ai', 'auth.claude.ai', 'api.claude.ai', 'account.anthropic.com'],
    anthropic_api: ['platform.claude.com', 'www.platform.claude.com'],
    claude_code: ['platform.claude.com', 'www.platform.claude.com'],
    opencode_go: ['opencode.ai', 'www.opencode.ai'],
    opencode_api: ['opencode.ai', 'www.opencode.ai'],
    zai: ['z.ai', 'www.z.ai'],
    codex: ['chatgpt.com', 'www.chatgpt.com'],
    openai_api: ['platform.openai.com', 'www.platform.openai.com'],
    cline: ['app.cline.bot', 'www.app.cline.bot'],
    openrouter: ['openrouter.ai', 'www.openrouter.ai']
  };

  function getConfiguredProviderKeys(providers) {
    const today = new Date().toISOString().slice(0, 10);
    return new Set(
      (Array.isArray(providers) ? providers : [])
        .filter((provider) => typeof provider?.key === 'string' && typeof provider?.plan_name === 'string' && provider.plan_name.trim() !== '')
        // Plans past their plan_valid_until date are expired → not synced anymore.
        .filter((provider) => !provider?.plan_valid_until || provider.plan_valid_until > today)
        .map((provider) => provider.key)
    );
  }

  function getCookieDomains(providerKeys) {
    const domains = new Set();
    for (const key of providerKeys || []) {
      for (const domain of PROVIDER_COOKIE_DOMAINS[key] || []) domains.add(domain);
    }
    return [...domains];
  }

  root.getConfiguredProviderKeys = getConfiguredProviderKeys;
  root.getCookieDomains = getCookieDomains;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getConfiguredProviderKeys, getCookieDomains };
  }
})(globalThis);
