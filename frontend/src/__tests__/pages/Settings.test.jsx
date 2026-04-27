import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Settings from '../../pages/Settings';

// Mock the API client
const mockGetPricing = vi.fn();
vi.mock('../../services/api', () => ({
  getPricing: () => mockGetPricing(),
  updatePricing: vi.fn(),
  confirmPricing: vi.fn(),
}));

describe('Settings pending-confirmation banner', () => {
  const baseRow = {
    model: 'Claude Sonnet 4.6',
    input_price: 3,
    output_price: 15,
    source: 'auto',
    status: 'active',
    tier: 'sonnet',
    api_id: 'claude-sonnet-4-6-20250929',
    last_updated: '2026-04-01T00:00:00Z',
  };

  it('does NOT show banner when no rows are pending_confirmation', async () => {
    mockGetPricing.mockResolvedValue({ pricing: [baseRow] });
    render(<Settings />);
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/New models detected/i)).not.toBeInTheDocument();
  });

  it('shows banner when at least one row is pending_confirmation', async () => {
    mockGetPricing.mockResolvedValue({
      pricing: [
        baseRow,
        {
          ...baseRow,
          model: 'unknown-future-model',
          status: 'pending_confirmation',
          source: 'tier_default',
          input_price: 0,
          output_price: 0,
        },
      ],
    });
    render(<Settings />);
    await waitFor(() => expect(screen.getByText(/New models detected/i)).toBeInTheDocument());
  });
});
