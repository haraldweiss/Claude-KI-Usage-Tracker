// SPDX-License-Identifier: AGPL-3.0-or-later
// © 2026 Harald Weiss
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ModelsTab from '../ModelsTab';
import { ModelBreakdown } from '../../types/api';

vi.mock('../ApiKeysDetailTable', () => ({ default: () => <div /> }));

describe('ModelsTab', () => {
  const mockModels: ModelBreakdown[] = [
    {
      model: 'Haiku 4.5',
      input_tokens: 1000000,
      output_tokens: 17000000,
      total_cost: 100,
      request_count: 50
    },
    {
      model: 'Opus 4.7',
      input_tokens: 39800,
      output_tokens: 5100000,
      total_cost: 200,
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
    const message = screen.getByText(/Keine per-message Token-Daten verfügbar/i);
    expect(message).toBeInTheDocument();
  });

  it('formats cost with dollar sign and decimals', () => {
    render(<ModelsTab models={mockModels} />);

    expect(screen.getByText(/\$100\./)).toBeInTheDocument();
    expect(screen.getByText(/\$200\./)).toBeInTheDocument();
  });
});
