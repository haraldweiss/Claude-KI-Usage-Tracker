// Claude Usage Tracker - Automatic API Interception
// Intercepts Claude.ai API calls and extracts usage data automatically

(function() {
  console.log('🚀 Claude Usage Tracker initialized');

  const originalFetch = window.fetch;
  const API_BASE = 'http://localhost:3000/api';

  // Override fetch to intercept Claude.ai API calls
  window.fetch = function(...args) {
    const [resource] = args;
    const resourceString = typeof resource === 'string' ? resource : resource?.url || '';

    // Check if this is a Claude.ai API call
    const isClaudeAPI = resourceString.includes('claude.ai') && resourceString.includes('/api/');

    if (isClaudeAPI) {
      console.log('📡 Claude API call detected:', resourceString);

      // Intercept and monitor the response
      return originalFetch.apply(this, args)
        .then(async (response) => {
          // Only process successful responses
          if (response.ok) {
            try {
              // Clone the response to read the body without consuming it
              const clonedResponse = response.clone();
              const responseData = await clonedResponse.json();

              // Extract usage from various API endpoints
              extractAndTrackUsage(responseData, resourceString);
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

    // For non-Claude APIs, use original fetch
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
  function extractAndTrackUsage(responseData, url) {
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
        model = model || 'Claude 3.5 Sonnet';

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

        // Send to background script for storage
        chrome.runtime.sendMessage({
          type: 'TRACK_USAGE',
          data: {
            model: model,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            conversation_id: conversationId,
            source: 'claude_ai_auto',
            // NEW FIELDS FOR RECOMMENDATIONS
            task_description: taskDescription,
            success_status: successData.status,
            response_metadata: responseMetadata
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

  // Format model ID to human-readable name
  function formatModelName(modelId) {
    const normalizedId = String(modelId).toLowerCase();

    // Map various model ID formats to readable names
    const modelMap = {
      'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
      'claude-3-5-haiku': 'Claude 3.5 Haiku',
      'claude-3-opus': 'Claude 3 Opus',
      'claude-3-sonnet': 'Claude 3 Sonnet',
      'claude-3-haiku': 'Claude 3 Haiku',
      'claude-2-1': 'Claude 2.1',
      'claude-2': 'Claude 2'
    };

    // Check exact matches first
    if (modelMap[normalizedId]) {
      return modelMap[normalizedId];
    }

    // Check partial matches
    for (const [key, value] of Object.entries(modelMap)) {
      if (normalizedId.includes(key)) {
        return value;
      }
    }

    // Fallback: format the ID nicely
    return modelId?.split('/').pop() || 'Claude 3.5 Sonnet';
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
