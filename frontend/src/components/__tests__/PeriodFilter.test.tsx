import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import PeriodFilter from '../PeriodFilter';

describe('PeriodFilter', () => {
  it('renders three filter buttons: Alle, 30d, 7d', () => {
    const handlePeriodChange = vi.fn();
    render(
      <PeriodFilter
        activePeriod="all"
        onPeriodChange={handlePeriodChange}
      />
    );

    expect(screen.getByText('Alle')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();
  });

  it('calls onPeriodChange with "all" when Alle is clicked', () => {
    const handlePeriodChange = vi.fn();
    render(
      <PeriodFilter
        activePeriod="30d"
        onPeriodChange={handlePeriodChange}
      />
    );

    const alleButton = screen.getByText('Alle');
    fireEvent.click(alleButton);

    expect(handlePeriodChange).toHaveBeenCalledWith('all');
  });

  it('calls onPeriodChange with "30d" when 30d is clicked', () => {
    const handlePeriodChange = vi.fn();
    render(
      <PeriodFilter
        activePeriod="all"
        onPeriodChange={handlePeriodChange}
      />
    );

    const button30d = screen.getByText('30d');
    fireEvent.click(button30d);

    expect(handlePeriodChange).toHaveBeenCalledWith('30d');
  });

  it('calls onPeriodChange with "7d" when 7d is clicked', () => {
    const handlePeriodChange = vi.fn();
    render(
      <PeriodFilter
        activePeriod="all"
        onPeriodChange={handlePeriodChange}
      />
    );

    const button7d = screen.getByText('7d');
    fireEvent.click(button7d);

    expect(handlePeriodChange).toHaveBeenCalledWith('7d');
  });

  it('highlights the active period button', () => {
    const handlePeriodChange = vi.fn();
    render(
      <PeriodFilter
        activePeriod="30d"
        onPeriodChange={handlePeriodChange}
      />
    );

    const button30d = screen.getByText('30d').closest('button');
    expect(button30d).toHaveClass('bg-gray-200', 'text-gray-900');
  });

  it('shows inactive button styling for non-active periods', () => {
    const handlePeriodChange = vi.fn();
    render(
      <PeriodFilter
        activePeriod="all"
        onPeriodChange={handlePeriodChange}
      />
    );

    const button30d = screen.getByText('30d').closest('button');
    expect(button30d).toHaveClass('bg-gray-100', 'text-gray-700');
    expect(button30d).not.toHaveClass('bg-gray-200');
  });

  it('has semantic ARIA attributes for accessibility', () => {
    const handlePeriodChange = vi.fn();
    render(
      <PeriodFilter
        activePeriod="all"
        onPeriodChange={handlePeriodChange}
      />
    );

    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-label', 'Time period filter');

    const alleButton = screen.getByRole('radio', { name: 'Alle' });
    expect(alleButton).toHaveAttribute('aria-checked', 'true');

    const button30d = screen.getByRole('radio', { name: '30d' });
    expect(button30d).toHaveAttribute('aria-checked', 'false');
  });
});
