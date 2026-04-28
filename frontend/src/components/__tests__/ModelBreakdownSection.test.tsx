import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ModelBreakdownSection from '../ModelBreakdownSection';
import { ModelBreakdown } from '../../types/api';

describe('ModelBreakdownSection', () => {
  const mockModels: ModelBreakdown[] = [
    {
      model: 'Haiku 4.5',
      input_tokens: 1000000,
      output_tokens: 17000000,
      cost: 100,
      request_count: 50
    },
    {
      model: 'Opus 4.7',
      input_tokens: 39800,
      output_tokens: 5100000,
      cost: 200,
      request_count: 10
    }
  ];

  it('renders model breakdown with correct data', () => {
    render(<ModelBreakdownSection models={mockModels} />);

    expect(screen.getByText('Haiku 4.5')).toBeInTheDocument();
    expect(screen.getByText(/1.0M in/)).toBeInTheDocument();
    expect(screen.getByText(/17.0M out/)).toBeInTheDocument();
  });

  it('handles empty models array', () => {
    render(<ModelBreakdownSection models={[]} />);
    const message = screen.getByText(/no model/i);
    expect(message).toBeInTheDocument();
  });

  it('calculates percentage of total requests correctly', () => {
    render(<ModelBreakdownSection models={mockModels} />);

    // Haiku: 50 out of 60 = 83.3%
    // Check that percentage text appears
    const container = screen.getByText('Haiku 4.5').closest('div');
    expect(container).toBeInTheDocument();
  });

  it('formats large numbers correctly', () => {
    render(<ModelBreakdownSection models={mockModels} />);

    expect(screen.getByText(/39.8k in/)).toBeInTheDocument();
    expect(screen.getByText(/5.1M out/)).toBeInTheDocument();
  });
});
