import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartTooltip } from '../../../src/components/Dashboard/PriceChart/ChartTooltip';

describe('ChartTooltip', () => {
  const format = (sats: number) => `${sats} sats`;
  const formatLabel = (t: number) => `at ${t}`;

  it('shows the value without a time when recharts supplies no hovered time', () => {
    const { container } = render(
      <ChartTooltip active payload={[{ value: 5 }]} format={format} formatLabel={formatLabel} />
    );
    expect(container).toHaveTextContent('5 sats');
    expect(container).not.toHaveTextContent('at ');
  });

  it('formats the hovered time', () => {
    const { container } = render(
      <ChartTooltip active payload={[{ value: 5 }]} label={1000} format={format} formatLabel={formatLabel} />
    );
    expect(container).toHaveTextContent('at 1000');
  });
});
