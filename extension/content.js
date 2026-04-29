// Claude Usage Tracker - Automatic API Interception
// Intercepts Claude.ai API calls and extracts usage data automatically

(function() {
  console.log('🚀 Claude Usage Tracker initialized');

  const originalFetch = window.fetch;
  const API_BASE = 'http://localhost:3000/api';

  // Dedupe recently-tracked usage events. Page reloads, retries, and streaming
  // chunk re-emissions can deliver the same usage payload more than once. Keep
  // a sliding window of fingerprints so we count each message exactly once.
  const TRACKED_TTL_MS = 5 * 60 * 1000;
  const recentlyTracked = new Map(); // fingerprint -> timestamp

  function pruneRecentlyTracked() {
    const cutoff = Date.now() - TRACKED_TTL_MS;
    for (const [fp, ts] of recentlyTracked) {
      if (ts < cutoff) recentlyTracked.delete(fp);
    }
  }

  function alreadyTracked(fingerprint) {
    pruneRecentlyTracked();
    if (recentlyTracked.has(fingerprint)) return true;
    recentlyTracked.set(fingerprint, Date.now());
    return false;
  }

  // Resolve the HTTP method for a fetch() call. Handles both shapes:
  //   fetch(url, { method: 'POST' })
  //   fetch(new Request(url, { method: 'POST' }))
  function resolveMethod(args) {
    const init = args[1];
    if (init && typeof init.method === 'string') return init.method.toUpperCase();
    const resource = args[0];
    if (resource && typeof resource === 'object' && typeof resource.method === 'string') {
      return resource.method.toUpperCase();
    }
    return 'GET';
  }

  // Best-effort extraction of the user's prompt text from a fetch() call's
  // request body. Returns null if the body isn't a parseable JSON string.
  // Used to feed Haiku categorization on the backend.
  async function extractRequestPrompt(args) {
    try {
      const init = args[1];
      const resource = args[0];
      let body = init?.body;

      // Request object case
      if (!body && resource && typeof resource === 'object' && typeof resource.clone === 'function') {
        try {
          body = await resource.clone().text();
        } catch {
          return null;
        }
      }

      if (typeof body !== 'string' || body.length === 0) return null;

      const json = JSON.parse(body);

      // Claude.ai sends a `prompt` field for new messages. Some endpoints use
      // a messages[] array — pull the latest user message text in that case.
      if (typeof json.prompt === 'string') return json.prompt;

      if (Array.isArray(json.messages)) {
        const lastUser = [...json.messages].reverse().find((m) => m.role === 'user');
        if (lastUser) {
          if (typeof lastUser.content === 'string') return lastUser.content;
          if (Array.isArray(lastUser.content)) {
            return lastUser.content
              .filter((c) => c.type === 'text' && typeof c.text === 'string')
              .map((c) => c.text)
              .join('\n');
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  // Pull plain assistant text out of a Claude API response. Handles both the
  // legacy { completion: "..." } shape and the newer content-array shape.
  function extractResponseText(responseData) {
    try {
      if (typeof responseData?.completion === 'string') return responseData.completion;

      if (Array.isArray(responseData?.content)) {
        return responseData.content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text)
          .join('\n');
      }

      if (typeof responseData?.message === 'string') return responseData.message;

      return null;
    } catch {
      return null;
    }
  }

  // Override fetch to intercept Claude.ai API calls
  window.fetch = function(...args) {
    const [resource] = args;
    const resourceString = typeof resource === 'string' ? resource : resource?.url || '';

    // Check if this is a Claude.ai API call
    const isClaudeAPI = resourceString.includes('claude.ai') && resourceString.includes('/api/');

    // Skip GETs entirely — they fetch existing data (conversation history,
    // org info, etc.) and would cause double-counting on every page reload.
    // Real message sends use POST/PUT.
    const method = resolveMethod(args);
    const isWrite = method !== 'GET' && method !== 'HEAD';

    if (isClaudeAPI && isWrite) {
      console.log(`📡 Claude API ${method}:`, resourceString);

      // Capture the prompt before issuing the call — once fetch consumes the
      // body stream we can't read it again.
      const promptPromise = extractRequestPrompt(args);

      // Intercept and monitor the response
      return originalFetch.apply(this, args)
        .then(async (response) => {
          // Only process successful responses
          if (response.ok) {
            try {
              // Clone the response to read the body without consuming it
              const clonedResponse = response.clone();
              const responseData = await clonedResponse.json();

              const rawPrompt = await promptPromise;
              const rawResponse = extractResponseText(responseData);

              // Extract usage from various API endpoints
              extractAndTrackUsage(responseData, resourceString, rawPrompt, rawResponse);
            } catch (error) {
              console.log('Could not parse response:', error.message);
            }
          }

          return response;
        })
        .catch(error => {
          console.error('Fetch error:', error);
          throw error;
        });
    }

    // For non-Claude APIs and read-only requests, use original fetch
    return originalFetch.apply(this, args);
  };

  // Extract task description from the page
  function getTaskDescription() {
    try {
      // Method 1: Try to get conversation title from DOM
      // Look for conversation title in sidebar or header
      const titleElement = document.querySelector(
        '[data-testid="conversation-title"], .conversation-title, h1[role="heading"]'
      );
      if (titleElement?.textContent) {
        const title = titleElement.textContent.trim();
        if (title && title.length > 0 && title.length < 500) {
          console.log('📝 Task title from DOM:', title);
          return title;
        }
      }

      // Method 2: Get from conversation history (latest user message)
      const userMessages = document.querySelectorAll('[data-testid="user-message"], .user-message');
      if (userMessages.length > 0) {
        const lastMessage = userMessages[userMessages.length - 1]?.textContent?.trim();
        if (lastMessage) {
          // Take first 100 characters as task description
          const truncated = lastMessage.substring(0, 150);
          console.log('📝 Task from last message:', truncated);
          return truncated;
        }
      }

      // Method 3: Fallback to generic description
      return 'Claude API Request';
    } catch (error) {
      console.log('Could not extract task description:', error.message);
      return 'Claude API Request';
    }
  }

  // Determine success status from response
  function getSuccessStatus(responseData, httpStatus) {
    try {
      // Check for explicit error in response
      if (responseData.error) {
        const errorType = responseData.error.type || responseData.error.message || 'unknown_error';
        console.log('❌ Response error detected:', errorType);
        return {
          status: 'error',
          error_type: errorType
        };
      }

      // Check for required fields
      if (!responseData.usage) {
        console.log('⚠️ No usage data in response');
        return {
          status: 'error',
          error_type: 'no_usage_data'
        };
      }

      // Check for content
      if (!responseData.content && !responseData.message) {
        console.log('⚠️ No content in response');
        return {
          status: 'error',
          error_type: 'no_content'
        };
      }

      // Check stop reason
      const stopReason = responseData.stop_reason || 'unknown';
      if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
        console.log('✅ Success - stop reason:', stopReason);
        return {
          status: 'success',
          stop_reason: stopReason
        };
      }

      if (stopReason === 'tool_use') {
        console.log('ℹ️ Tool use - stop reason:', stopReason);
        return {
          status: 'success',
          stop_reason: stopReason
        };
      }

      if (stopReason === 'content_filter') {
        console.log('🚫 Content filtered');
        return {
          status: 'filtered',
          stop_reason: stopReason
        };
      }

      // Default to success if we got tokens
      console.log('✅ Success - normal completion');
      return {
        status: 'success',
        stop_reason: stopReason
      };
    } catch (error) {
      console.log('Could not determine success status:', error.message);
      return {
        status: 'unknown',
        error_type: 'status_check_failed'
      };
    }
  }

  // Extract response metadata
  function getResponseMetadata(responseData) {
    try {
      const metadata = {
        stop_reason: responseData.stop_reason || null,
        error_type: responseData.error?.type || null
      };

      // Add finish details if available
      if (responseData.finish_reason) {
        metadata.finish_reason = responseData.finish_reason;
      }

      // Add content analysis if available
      if (responseData.content) {
        metadata.content_type = Array.isArray(responseData.content) ? 'array' : 'object';
        metadata.content_length = String(responseData.content).length;
      }

      return metadata;
    } catch (error) {
      console.log('Could not extract metadata:', error.message);
      return {};
    }
  }

  // Extract usage data from Claude API responses
  function extractAndTrackUsage(responseData, url, rawPrompt, rawResponse) {
    try {
      // Handle different API response formats
      let model = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let conversationId = null;

      // Format 1: usage object at top level (messages endpoint)
      if (responseData.usage) {
        inputTokens = responseData.usage.input_tokens || 0;
        outputTokens = responseData.usage.output_tokens || 0;
      }

      // Format 2: stop_reason indicates completion
      if (responseData.stop_reason && responseData.content) {
        // This is likely a message response
        inputTokens = responseData.usage?.input_tokens || 0;
        outputTokens = responseData.usage?.output_tokens || 0;
      }

      // Extract model name
      if (responseData.model) {
        model = formatModelName(responseData.model);
      }

      // Extract conversation ID from URL or response
      const urlMatch = url.match(/conversations\/([a-f0-9\-]+)/);
      if (urlMatch) {
        conversationId = urlMatch[1];
      }

      // Only track if we have meaningful token data
      if (inputTokens > 0 || outputTokens > 0) {
        // If the response didn't include a model id, try to read the
        // currently-selected model from the page header. Falling back to a
        // hard-coded "Claude 3.5 Sonnet" mis-attributes everything to a model
        // the user may not even be using.
        if (!model) {
          const fromDom = readSelectedModelFromDom();
          if (fromDom) model = fromDom;
        }
        model = model || 'Unknown';

        // Dedupe: same conversation + same token counts + same model arriving
        // again within 5 minutes is almost certainly a re-fire (streaming
        // chunk re-emit, page reload, retry). Use the response's own message
        // id when available for an exact fingerprint, else fall back to a
        // composite of conversation/model/tokens.
        const messageId =
          responseData?.id || responseData?.uuid || responseData?.message_id || null;
        const fingerprint = messageId
          ? `msg:${messageId}`
          : `c:${conversationId || 'none'}|m:${model}|i:${inputTokens}|o:${outputTokens}`;
        if (alreadyTracked(fingerprint)) {
          console.log('⏭️  Skipping duplicate usage event:', fingerprint);
          return;
        }

        // Extract new fields for recommendations
        const taskDescription = getTaskDescription();
        const successData = getSuccessStatus(responseData);
        const responseMetadata = getResponseMetadata(responseData);

        console.log('✅ Usage detected:', {
          model,
          inputTokens,
          outputTokens,
          conversationId,
          taskDescription,
          successData,
          responseMetadata
        });

        // Send to background script for storage. raw_prompt/raw_response
        // power Haiku categorization on the backend; everything else is
        // unchanged from the existing tracker.
        chrome.runtime.sendMessage({
          type: 'TRACK_USAGE',
          data: {
            model: model,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            conversation_id: conversationId,
            source: 'claude_ai_auto',
            task_description: taskDescription,
            success_status: successData.status,
            response_metadata: responseMetadata,
            raw_prompt: rawPrompt || null,
            raw_response: rawResponse || null
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Track error:', chrome.runtime.lastError.message);
          } else if (response?.success) {
            console.log('✅ Usage tracked - Cost: $' + response.data?.cost);
          }
        });
      }
    } catch (error) {
      console.error('❌ Error extracting usage:', error);
    }
  }

  // Last-resort model attribution: scrape the model selector chip in the
  // chat header. Returns null if no recognizable model name is visible.
  function readSelectedModelFromDom() {
    try {
      const selectors = [
        '[data-testid="model-selector-dropdown"]',
        'button[aria-haspopup="menu"][aria-label*="model" i]',
        '[data-testid="model-selector"]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        const text = el?.textContent?.trim();
        if (text && /claude/i.test(text) && text.length < 80) {
          return text.replace(/\s+/g, ' ');
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Format model ID to human-readable name
  function formatModelName(modelId) {
    if (!modelId) return 'Unknown';
    const normalizedId = String(modelId).toLowerCase().trim();

    // Known display-name overrides (keep in sync with backend tier inference)
    const explicitMap = {
      'claude-opus-4-7': 'Claude Opus 4.7',
      'claude-sonnet-4-6': 'Claude Sonnet 4.6',
      'claude-haiku-4-5': 'Claude Haiku 4.5',
      'claude-3-7-sonnet': 'Claude 3.7 Sonnet',
      'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
      'claude-3-5-haiku': 'Claude 3.5 Haiku',
      'claude-3-opus': 'Claude 3 Opus',
      'claude-3-sonnet': 'Claude 3 Sonnet',
      'claude-3-haiku': 'Claude 3 Haiku',
      'claude-2-1': 'Claude 2.1',
      'claude-2': 'Claude 2'
    };

    // Strip date suffix for matching: claude-opus-4-7-20251101 → claude-opus-4-7
    const stripped = normalizedId.replace(/-\d{8}$/, '');
    if (explicitMap[stripped]) return explicitMap[stripped];

    // Generic claude-* fallback: derive a name like "Claude Opus 4.7"
    const TIERS = ['haiku', 'sonnet', 'opus'];
    const match = stripped.match(/^claude-([a-z0-9-]+)$/);
    if (match) {
      const parts = match[1].split('-');
      const tier = TIERS.find((t) => parts.includes(t));
      if (tier) {
        const tierIdx = parts.indexOf(tier);
        const versionParts = parts.slice(0, tierIdx).concat(parts.slice(tierIdx + 1));
        const version = versionParts.join('.');
        const cap = tier.charAt(0).toUpperCase() + tier.slice(1);
        const versionFirst = tierIdx > 0 && /^\d/.test(parts[0]);
        return (versionFirst ? `Claude ${version} ${cap}` : `Claude ${cap} ${version}`)
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    // Last resort: pass the raw ID — backend's normalizeIncomingModel will handle it.
    return modelId;
  }

  console.log('✅ Claude Usage Tracker ready - monitoring API calls');
})();

// Listen for scraping requests from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script received message:', request.type);

  if (request.type === 'SCRAPE_USAGE') {
    try {
      const data = scrapeUsageFromSettings();
      console.log('Scraped data:', data);
      sendResponse({ success: true, data: data });
    } catch (error) {
      console.error('Scraping error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep the message channel open for async response
  }

  return false;
});

// Scrape usage data from Claude's settings page
function scrapeUsageFromSettings() {
  let scrapedData = {
    monthly_spent: 0,
    weekly_used: 0,
    session_used: 0,
    timestamp: new Date().toISOString()
  };

  try {
    // Get all text content from the page
    const allText = document.body.innerText;
    console.log('Page text sample:', allText.substring(0, 500));

    // Look for pattern like "0,09 €" or "$0.09" or "€0.09"
    const currencyMatch = allText.match(/[\d,\.]+\s*[€$]|[€$]\s*[\d,\.]+/);
    if (currencyMatch) {
      const amount = currencyMatch[0].replace(/[€$\s]/g, '').replace(',', '.');
      scrapedData.monthly_spent = parseFloat(amount) || 0;
      console.log('Found monthly spent:', scrapedData.monthly_spent);
    }

    // Look for percentage patterns
    const percentMatches = allText.match(/(\d+)\s*%/g);
    if (percentMatches && percentMatches.length > 0) {
      scrapedData.weekly_used = parseInt(percentMatches[0]) || 0;
      console.log('Found weekly usage %:', scrapedData.weekly_used);
    }

    console.log('Final scraped data:', scrapedData);
    return scrapedData;

  } catch (error) {
    console.error('Error scraping usage:', error);
    return scrapedData;
  }
}

console.log('Claude Usage Tracker content script loaded');
