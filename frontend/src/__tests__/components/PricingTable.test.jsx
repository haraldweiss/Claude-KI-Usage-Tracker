import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PricingTable from '../../components/PricingTable';

// Mock the API client so the component renders without network
vi.mock('../../services/api', () => ({
  updatePricing: vi.fn(),
  confirmPricing: vi.fn().mockResolvedValue(undefined),
}));

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

describe('PricingTable badges', () => {
  it('shows green "auto" badge for auto-source rows', () => {
    render(<PricingTable pricing={[{ ...baseRow }]} />);
    const badge = screen.getByText('auto');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/bg-green-100/);
  });

  it('shows blue "manual" badge for manual-source rows', () => {
    render(<PricingTable pricing={[{ ...baseRow, source: 'manual' }]} />);
    const badge = screen.getByText('manual');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/bg-blue-100/);
  });

  it('shows amber "Needs review" badge for pending_confirmation rows', () => {
    render(
      <PricingTable
        pricing={[{ ...baseRow, source: 'tier_default', status: 'pending_confirmation' }]}
      />
    );
    const badge = screen.getByText('Needs review');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/bg-amber-100/);
  });

  it('shows grey "Deprecated" badge for deprecated rows', () => {
    render(<PricingTable pricing={[{ ...baseRow, status: 'deprecated' }]} />);
    const badge = screen.getByText('Deprecated');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/bg-gray-200/);
  });
});

describe('PricingTable Confirm button', () => {
  it('does not render a Confirm button on active rows', () => {
    render(<PricingTable pricing={[{ ...baseRow }]} />);
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
  });

  it('renders a Confirm button on pending_confirmation rows', () => {
    render(
      <PricingTable
        pricing={[{ ...baseRow, status: 'pending_confirmation', input_price: 0, output_price: 0 }]}
      />
    );
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });

  it('calls confirmPricing and onUpdate when Confirm is clicked', async () => {
    const { confirmPricing } = await import('../../services/api');
    const onUpdate = vi.fn();
    render(
      <PricingTable
        pricing={[{ ...baseRow, status: 'pending_confirmation', input_price: 2.5, output_price: 12 }]}
        onUpdate={onUpdate}
      />
    );

    const button = screen.getByRole('button', { name: /confirm/i });
    fireEvent.click(button);

    // Wait for the async click handler to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(confirmPricing).toHaveBeenCalledWith('Claude Sonnet 4.6', 2.5, 12);
    expect(onUpdate).toHaveBeenCalled();
  });
});
