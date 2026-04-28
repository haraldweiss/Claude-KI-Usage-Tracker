import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ModelsTab from '../ModelsTab';
import { ModelBreakdown } from '../../types/api';

describe('ModelsTab', () => {
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

  it('renders models table', () => {
    render(<ModelsTab models={mockModels} />);

    expect(screen.getByText('Haiku 4.5')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
  });

  it('renders table headers correctly', () => {
    render(<ModelsTab models={mockModels} />);

    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Input Tokens')).toBeInTheDocument();
    expect(screen.getByText('Output Tokens')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
  });

  it('displays all model data correctly', () => {
    render(<ModelsTab models={mockModels} />);

    expect(screen.getByText('Opus 4.7')).toBeInTheDocument();
    expect(screen.getByText(/1.0M/)).toBeInTheDocument();
    expect(screen.getByText(/17.0M/)).toBeInTheDocument();
  });

  it('handles empty models', () => {
    render(<ModelsTab models={[]} />);
    const message = screen.getByText(/no model/i);
    expect(message).toBeInTheDocument();
  });

  it('formats cost with dollar sign and decimals', () => {
    render(<ModelsTab models={mockModels} />);

    expect(screen.getByText(/\$100\./)).toBeInTheDocument();
    expect(screen.getByText(/\$200\./)).toBeInTheDocument();
  });
});
