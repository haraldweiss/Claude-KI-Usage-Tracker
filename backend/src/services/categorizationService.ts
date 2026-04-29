import Anthropic from '@anthropic-ai/sdk';

export type Category = 'Code' | 'Research' | 'Analysis' | 'Writing' | 'Support' | 'Other';

export interface CategorizationResult {
  category: Category;
  effectiveness_score: number;
  reasoning: string;
}

const VALID_CATEGORIES: readonly Category[] = [
  'Code',
  'Research',
  'Analysis',
  'Writing',
  'Support',
  'Other'
];

const MAX_TEXT_LENGTH = 2000;
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Truncate text preserving start and end (avoids losing context for categorization).
 */
function truncateText(text: string, maxLength: number = MAX_TEXT_LENGTH): string {
  if (!text || text.length <= maxLength) return text || '';
  const half = Math.floor(maxLength / 2);
  return `${text.substring(0, half)}\n...[truncated]...\n${text.substring(text.length - half)}`;
}

const SYSTEM_PROMPT = `You categorize user-assistant interactions for a usage tracker.

Categories:
- Code: Programming, debugging, code reviews, technical implementation, scripting
- Research: Fact-finding, explanations, learning, information gathering
- Analysis: Data analysis, comparisons, evaluations, business reasoning
- Writing: Content creation, text refinement, creative writing
- Support: Troubleshooting, help requests, how-to guidance
- Other: Anything that does not fit the above

Also rate effectiveness (0.0-1.0): did the assistant's response successfully address the user's request? Consider completeness, correctness, and usefulness.

Respond ONLY with valid JSON (no markdown, no extra text):
{"category": "Code", "effectiveness_score": 0.85, "reasoning": "Short explanation."}`;

/**
 * Categorize a user-assistant interaction using Claude Haiku.
 * Returns category, effectiveness score (0-1), and short reasoning.
 * Throws on API errors or malformed responses — callers handle retry/pending state.
 */
export async function categorize(
  prompt: string,
  response: string
): Promise<CategorizationResult> {
  const truncatedPrompt = truncateText(prompt);
  const truncatedResponse = truncateText(response);

  const userMessage = `User Prompt:
${truncatedPrompt}

Assistant Response:
${truncatedResponse}`;

  const apiResponse = await getClient().messages.create({
    model: HAIKU_MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  });

  const block = apiResponse.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('Unexpected response type from Haiku');
  }

  const parsed = JSON.parse(block.text) as Partial<CategorizationResult>;

  if (
    !parsed.category ||
    !(VALID_CATEGORIES as readonly string[]).includes(parsed.category) ||
    typeof parsed.effectiveness_score !== 'number'
  ) {
    throw new Error(`Invalid categorization response: ${block.text}`);
  }

  const score = Math.max(0, Math.min(1, parsed.effectiveness_score));

  return {
    category: parsed.category as Category,
    effectiveness_score: score,
    reasoning: parsed.reasoning ?? ''
  };
}

export const __testing = { truncateText, VALID_CATEGORIES };
