import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthHistoryBlocks } from '../../../components/ElectrumServerSettings/HealthHistoryBlocks';
import type { HealthCheckResult } from '../../../src/api/bitcoin';

const makeCheck = (overrides: Partial<HealthCheckResult> = {}): HealthCheckResult => ({
  timestamp: '2025-01-01T00:00:00.000Z',
  success: true,
  ...overrides,
});

const getStatusDots = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll('div[title]')).filter((el) => {
    const title = el.getAttribute('title') || '';
    return title.startsWith('✓') || title.startsWith('✗');
  }) as HTMLElement[];

describe('HealthHistoryBlocks', () => {
  it('renders nothing for empty history', () => {
    const { container } = render(<HealthHistoryBlocks history={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for null history', () => {
    const { container } = render(
      <HealthHistoryBlocks history={null as unknown as HealthCheckResult[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders success and failure blocks with expected tooltips and classes', () => {
    const { container } = render(
      <HealthHistoryBlocks
        history={[
          makeCheck({ latencyMs: 120 }),
          makeCheck({
            timestamp: '2025-01-01T00:01:00.000Z',
            success: false,
            error: 'rpc timeout',
          }),
          makeCheck({
            timestamp: '2025-01-01T00:02:00.000Z',
            success: false,
          }),
        ]}
      />
    );

    expect(
      screen.getByTitle('Recent health checks (newest → oldest)')
    ).toBeInTheDocument();
    expect(screen.getByTitle(/\(120ms\)/)).toBeInTheDocument();
    expect(screen.getByTitle(/rpc timeout/)).toBeInTheDocument();

    const dots = getStatusDots(container);
    expect(dots).toHaveLength(3);
    expect(dots[0].className).toContain('bg-success-500');
    expect(dots[1].className).toContain('bg-rose-500');
    expect(dots[2].getAttribute('title')).toMatch(/^✗ /);
  });

  it('limits blocks by maxBlocks and shows overflow count', () => {
    const { container } = render(
      <HealthHistoryBlocks
        history={[
          makeCheck({ timestamp: '2025-01-01T00:00:00.000Z' }),
          makeCheck({ timestamp: '2025-01-01T00:01:00.000Z' }),
          makeCheck({ timestamp: '2025-01-01T00:02:00.000Z' }),
          makeCheck({ timestamp: '2025-01-01T00:03:00.000Z' }),
        ]}
        maxBlocks={2}
      />
    );

    expect(getStatusDots(container)).toHaveLength(2);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
