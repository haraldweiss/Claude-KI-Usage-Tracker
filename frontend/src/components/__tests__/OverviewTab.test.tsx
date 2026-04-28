import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import OverviewTab from '../OverviewTab';
import { BarChartData } from '../../types/components';
import { ModelBreakdown } from '../../types/api';

describe('OverviewTab', () => {
  const mockChartData: BarChartData[] = [{ date: '2026-04-01', tokens: 1000 }];
  const mockModels: ModelBreakdown[] = [
    {
      model: 'Haiku 4.5',
      input_tokens: 1000000,
      output_tokens: 17000000,
      cost: 100,
      request_count: 50
    }
  ];

  it('renders bar chart and model breakdown', () => {
    render(
      <OverviewTab
        chartData={mockChartData}
        models={mockModels}
      />
    );

    expect(screen.getByTestId('bar-chart-container')).toBeInTheDocument();
    expect(screen.getByText('Model Breakdown')).toBeInTheDocument();
  });

  it('displays chart with data', () => {
    render(
      <OverviewTab
        chartData={mockChartData}
        models={mockModels}
      />
    );

    const chart = screen.getByTestId('bar-chart-container');
    expect(chart).toBeInTheDocument();
  });

  it('renders model breakdown section correctly', () => {
    render(
      <OverviewTab
        chartData={mockChartData}
        models={mockModels}
      />
    );

    expect(screen.getByText('Haiku 4.5')).toBeInTheDocument();
    expect(screen.getByText(/1.0M in/)).toBeInTheDocument();
  });
});
