import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsageSummary from '../../components/UsageSummary';

// Mock the priceService
vi.mock('../../services/priceService', () => ({
  formatCost: (cost) => {
    if (typeof cost !== 'number') return '$0.00';
    return `$${cost.toFixed(2)}`;
  },
  formatTokens: (tokens) => {
    if (typeof tokens !== 'number') return '0';
    // Use German locale formatting (de-DE)
    return tokens.toLocaleString('de-DE');
  }
}));

describe('UsageSummary Component', () => {
  const mockStats = {
    total_tokens: 5000,
    total_input_tokens: 3000,
    total_output_tokens: 2000,
    total_cost: 15.5,
    request_count: 25
  };

  it('should render all summary cards with data', () => {
    render(<UsageSummary stats={mockStats} />);

    expect(screen.getByText('Total Tokens')).toBeInTheDocument();
    expect(screen.getByText('Input Tokens')).toBeInTheDocument();
    expect(screen.getByText('Output Tokens')).toBeInTheDocument();
    expect(screen.getByText('Estimated Cost')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
  });

  it('should display formatted numbers', () => {
    render(<UsageSummary stats={mockStats} />);

    expect(screen.getByText('5.000')).toBeInTheDocument();
    expect(screen.getByText('3.000')).toBeInTheDocument();
    expect(screen.getByText('2.000')).toBeInTheDocument();
    expect(screen.getByText('$15.50')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('should display default values when stats is empty', () => {
    render(<UsageSummary stats={{}} />);

    expect(screen.getAllByText('0')).toHaveLength(4);
  });

  it('should display default values when stats is undefined', () => {
    render(<UsageSummary />);

    // Should render 4 cards with '0' (formatTokens returns '0', request_count also '0')
    expect(screen.getAllByText('0')).toHaveLength(4);
  });

  it('should format large numbers with thousand separators', () => {
    const largeStats = {
      ...mockStats,
      total_tokens: 1000000,
      total_cost: 5000.75
    };

    render(<UsageSummary stats={largeStats} />);

    expect(screen.getByText('1.000.000')).toBeInTheDocument();
    expect(screen.getByText('$5000.75')).toBeInTheDocument();
  });

  it('should handle zero values gracefully', () => {
    const zeroStats = {
      total_tokens: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost: 0,
      request_count: 0
    };

    render(<UsageSummary stats={zeroStats} />);

    // Should render 4 cards with '0' values
    expect(screen.getAllByText('0')).toHaveLength(4);
  });
});