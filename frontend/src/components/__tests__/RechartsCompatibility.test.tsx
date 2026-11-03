import { Fragment } from 'react';
import { render } from '@testing-library/react';
import { Bar, BarChart } from 'recharts';
import { describe, expect, it } from 'vitest';

describe('React and Recharts dependency compatibility', () => {
  // This boundary must use real Recharts: mocked charts cannot detect a
  // react-is version that fails to recognize React 19 fragments.
  it.each([false, true])('renders both data points with fragment=%s', (fragment) => {
    const bars = <Bar dataKey="cost" isAnimationActive={false} />;
    const { container } = render(
      <BarChart width={400} height={300} data={[{ cost: 10 }, { cost: 20 }]}>
        {fragment ? <Fragment>{bars}</Fragment> : bars}
      </BarChart>
    );

    expect(container.querySelectorAll('.recharts-bar-rectangle path')).toHaveLength(2);
  });
});
