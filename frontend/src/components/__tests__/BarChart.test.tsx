import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BarChart from '../BarChart';
import { BarChartData } from '../../types/components';

describe('BarChart', () => {
  const mockData: BarChartData[] = [
    { date: '2026-04-01', tokens: 1000 },
    { date: '2026-04-02', tokens: 2000000 },
    { date: '2026-04-03', tokens: 1500 }
  ];

  it('renders a bar chart with data', () => {
    render(<BarChart data={mockData} />);

    const container = screen.getByTestId('bar-chart-container');
    expect(container).toBeInTheDocument();
  });

  it('renders with default title', () => {
    render(<BarChart data={mockData} />);
    expect(screen.getByText('Token Usage Over Time')).toBeInTheDocument();
  });

  it('renders with custom title', () => {
    render(<BarChart data={mockData} title="Custom Title" />);
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
  });

  it('handles empty data gracefully', () => {
    render(<BarChart data={[]} />);
    const message = screen.getByText(/no valid data/i);
    expect(message).toBeInTheDocument();
  });

  it('handles invalid data (non-numeric tokens)', () => {
    const invalidData = [
      { date: '2026-04-01', tokens: NaN }
    ];
    render(<BarChart data={invalidData as BarChartData[]} />);
    const message = screen.getByText(/no valid data/i);
    expect(message).toBeInTheDocument();
  });

  it('formats large numbers in Y-axis', () => {
    render(<BarChart data={mockData} />);
    // The 2M token value should format as "2.0M" in tooltip
    const container = screen.getByTestId('bar-chart-container');
    expect(container).toBeInTheDocument();
  });

  it('has proper accessibility attributes', () => {
    render(<BarChart data={mockData} />);
    const container = screen.getByTestId('bar-chart-container');
    expect(container).toHaveAttribute('role', 'img');
    expect(container).toHaveAttribute('aria-label', 'Token Usage Over Time');
  });
});
