// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CombinedCostTab from '../CombinedCostTab';

vi.mock('../../services/api', () => ({
  getSummary: vi.fn().mockResolvedValue({
    combined: {
      claude_ai: null,
      anthropic_api: { cost_usd: 10, cost_eur_equivalent: 10, by_workspace: [] },
      opencode_api: { total_cost_usd: 20 },
      openai_api: { cost_usd: 30 },
      exchange_rate: { usd_to_eur: 0.9, rate_date: '2026-07-21' }
    }
  }),
  getConsoleKeys: vi.fn().mockResolvedValue({ keys: [] }),
  getPlanPricing: vi.fn().mockResolvedValue({ plans: [] }),
  getSpendingTotal: vi.fn().mockResolvedValue({ since: null }),
  getProviders: vi.fn().mockResolvedValue({
    providers: [
      { key: 'anthropic_api', plan_name: null },
      { key: 'opencode_api', plan_name: null },
      { key: 'openai_api', plan_name: 'API Usage' }
    ]
  })
}));

describe('CombinedCostTab', () => {
  it('excludes API costs for providers without an active configuration', async () => {
    render(<CombinedCostTab />);

    expect((await screen.findAllByText(/27,00/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/OpenAI API/)).toBeInTheDocument();
  });
});
