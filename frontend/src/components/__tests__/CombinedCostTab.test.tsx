// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CombinedCostTab from '../CombinedCostTab';
import { getPlanPricing, getProviders, getSpendingTotal, getSummary } from '../../services/api';

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
  it('keeps Anthropic API costs with no configured plan when current costs exist', async () => {
    render(<CombinedCostTab />);

    expect((await screen.findAllByText(/37,00/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Anthropic API/).length).toBeGreaterThan(0);
    expect(screen.getByText(/OpenAI API/)).toBeInTheDocument();
  });

  it('hides stale Claude.ai data and an unused Anthropic API', async () => {
    vi.mocked(getSummary).mockResolvedValueOnce({
      combined: {
        claude_ai: {
          cost_eur: 19,
          weekly_used_pct: 50,
          last_synced: '2026-07-21T10:00:00.000Z',
          meta: { plan_name: 'Pro' }
        },
        anthropic_api: { cost_usd: 0, cost_eur_equivalent: 0, by_workspace: [] }
      }
    } as any);
    vi.mocked(getPlanPricing).mockResolvedValueOnce({ plans: [{ plan_name: 'Pro', monthly_eur: 19, source: 'manual', last_updated: '2026-07-01' }] });
    vi.mocked(getSpendingTotal).mockResolvedValueOnce({
      since: '2026-07-01',
      claude_ai: {
        total_eur: 19,
        subscription_eur: 19,
        additional_eur: 0,
        months: [{ month: '2026-07-01', plan_name: 'Pro', subscription_eur: 19, additional_eur: 0, total_eur: 19 }]
      },
      anthropic_api: { total_usd: 0 }
    });
    vi.mocked(getProviders).mockResolvedValueOnce({
      providers: [
        { key: 'claude_ai', plan_name: null },
        { key: 'anthropic_api', plan_name: null }
      ]
    });

    render(<CombinedCostTab />);

    await screen.findByText('Gesamtkosten diesen Monat');
    expect(screen.queryByText('claude.ai')).not.toBeInTheDocument();
    expect(screen.queryByText(/Anthropic API/)).not.toBeInTheDocument();
  });
});
