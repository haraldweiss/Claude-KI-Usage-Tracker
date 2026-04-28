import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BarChart from '../BarChart';

describe('BarChart', () => {
  it('renders a bar chart with data', () => {
    const mockData = [
      { date: '2026-04-01', tokens: 1000 },
      { date: '2026-04-02', tokens: 2000 },
      { date: '2026-04-03', tokens: 1500 }
    ];

    render(<BarChart data={mockData} />);

    const container = screen.getByTestId('bar-chart-container');
    expect(container).toBeInTheDocument();
  });

  it('handles empty data gracefully', () => {
    render(<BarChart data={[]} />);
    const message = screen.getByText(/no data/i);
    expect(message).toBeInTheDocument();
  });
});
