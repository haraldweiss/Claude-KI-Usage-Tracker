// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import OverviewTab from '../OverviewTab';
import { getPlanPricing, getProviders, getSpendingTotal, getSummary } from '../../services/api';

vi.mock('../../services/api', () => ({
  getSummary: vi.fn().mockResolvedValue({
    combined: {
      claude_ai: null,
      anthropic_api: { cost_usd: 10, cost_eur_equivalent: 10, by_workspace: [] },
      opencode_api: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_cost_usd: 20,
        row_count: 1,
        by_key: []
      },
      openai_api: {
        organization_name: 'Test org',
        period_start: '2026-07-01',
        period_end: '2026-07-21',
        cost_usd: 30,
        total_input_tokens: 0,
        total_output_tokens: 0,
        requests: 0,
        last_synced: '2026-07-21T10:00:00.000Z'
      },
      exchange_rate: { usd_to_eur: 0.9, rate_date: '2026-07-21' }
    }
  }),
  getSpendingTotal: vi.fn().mockResolvedValue({
    since: null,
    claude_ai: { total_eur: 0, subscription_eur: 0, additional_eur: 0, months: [] },
    anthropic_api: { total_usd: 0 }
  }),
  getPlanPricing: vi.fn().mockResolvedValue({ plans: [] }),
  getProviders: vi.fn().mockResolvedValue({ providers: [] })
}));

vi.mock('../LocalUsageCard', () => ({
  default: () => <div data-testid="local-usage-card" />
}));

describe('OverviewTab', () => {
  it('renders without crashing', () => {
    render(<OverviewTab />);
    expect(screen.getByText(/Lade Übersicht/i)).toBeInTheDocument();
  });

  it('includes configured API costs in the monthly total', async () => {
    render(<OverviewTab />);

    expect((await screen.findAllByText(/55,00/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/OpenCode API/)).toBeInTheDocument();
    expect(screen.getByText(/OpenAI API/)).toBeInTheDocument();
  });

  it('hides unsubscribed Claude.ai and an unused Anthropic API', async () => {
    vi.mocked(getSummary).mockResolvedValueOnce({
      combined: {
        claude_ai: {
          cost_eur: 19,
          weekly_used_pct: 50,
          last_synced: '2026-07-21T10:00:00.000Z',
          meta: { plan_name: 'Pro', reset_date: '2026-07-25' }
        },
        anthropic_api: { cost_usd: 0, cost_eur_equivalent: 0, by_workspace: [] }
      }
    } as any);
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
    vi.mocked(getPlanPricing).mockResolvedValueOnce({ plans: [{ plan_name: 'Pro', monthly_eur: 19, source: 'manual', last_updated: '2026-07-01' }] });
    vi.mocked(getProviders).mockResolvedValueOnce({
      providers: [
        { key: 'claude_ai', plan_name: null },
        { key: 'anthropic_api', plan_name: null }
      ]
    });

    render(<OverviewTab />);

    await screen.findByText('Anbieter-Status');
    expect(screen.queryByText('Claude.ai')).not.toBeInTheDocument();
    expect(screen.queryByText(/Anthropic API/)).not.toBeInTheDocument();
  });

  it('keeps Anthropic API visible when it has current costs without a configured plan', async () => {
    vi.mocked(getSummary).mockResolvedValueOnce({
      combined: {
        claude_ai: null,
        anthropic_api: { cost_usd: 10, cost_eur_equivalent: 9, by_workspace: [] }
      }
    } as any);
    vi.mocked(getProviders).mockResolvedValueOnce({
      providers: [
        { key: 'claude_ai', plan_name: null },
        { key: 'anthropic_api', plan_name: null }
      ]
    });

    render(<OverviewTab />);

    expect(await screen.findByText(/Anthropic API/)).toBeInTheDocument();
  });
});
