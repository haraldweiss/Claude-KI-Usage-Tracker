import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsageChart from '../../components/UsageChart';

// Mock recharts components
vi.mock('recharts', () => ({
  PieChart: ({ children }) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ data, label, children }) => (
    <div data-testid="pie">
      {data?.map((item, idx) => (
        <div key={idx} data-testid={`pie-item-${idx}`}>
          {item.name}
        </div>
      ))}
      {children}
    </div>
  ),
  Cell: () => null,
  Legend: () => <div data-testid="legend" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>
}));

describe('UsageChart Component', () => {
  const mockModelData = [
    { model: 'claude-3-sonnet', total_tokens: 50000 },
    { model: 'claude-3-haiku', total_tokens: 30000 },
    { model: 'claude-3-opus', total_tokens: 20000 }
  ];

  it('should render chart with model data', () => {
    render(<UsageChart modelData={mockModelData} />);

    expect(screen.getByText('Usage by Model')).toBeInTheDocument();
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
  });

  it('should display model names in the chart', () => {
    render(<UsageChart modelData={mockModelData} />);

    expect(screen.getByText('claude-3-sonnet')).toBeInTheDocument();
    expect(screen.getByText('claude-3-haiku')).toBeInTheDocument();
    expect(screen.getByText('claude-3-opus')).toBeInTheDocument();
  });

  it('should render legend and tooltip', () => {
    render(<UsageChart modelData={mockModelData} />);

    expect(screen.getByTestId('legend')).toBeInTheDocument();
    expect(screen.getByTestId('tooltip')).toBeInTheDocument();
  });

  it('should show "No data available" when modelData is empty', () => {
    render(<UsageChart modelData={[]} />);

    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('should show "No data available" when modelData is null', () => {
    render(<UsageChart modelData={null} />);

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('should show "No data available" when modelData is undefined', () => {
    render(<UsageChart />);

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('should handle single model data', () => {
    const singleModel = [{ model: 'claude-3-sonnet', total_tokens: 100000 }];

    render(<UsageChart modelData={singleModel} />);

    expect(screen.getByText('claude-3-sonnet')).toBeInTheDocument();
    expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
  });

  it('should handle large token counts', () => {
    const largeData = [
      { model: 'claude-3-sonnet', total_tokens: 5000000 },
      { model: 'claude-3-haiku', total_tokens: 3000000 }
    ];

    render(<UsageChart modelData={largeData} />);

    expect(screen.getByText('claude-3-sonnet')).toBeInTheDocument();
    expect(screen.getByText('claude-3-haiku')).toBeInTheDocument();
  });

  it('should render responsive container', () => {
    render(<UsageChart modelData={mockModelData} />);

    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });
});