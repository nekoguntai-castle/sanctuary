import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthHistoryBlocks } from '../../../components/NetworkConnectionCard/HealthHistoryBlocks';
import type { HealthCheckResult } from '../../../src/api/bitcoin';

const makeCheck = (overrides: Partial<HealthCheckResult> = {}): HealthCheckResult => ({
  timestamp: '2025-01-01T00:00:00.000Z',
  success: true,
  ...overrides,
});

describe('NetworkConnectionCard HealthHistoryBlocks', () => {
  it('renders nothing for null and empty history', () => {
    const { container: nullContainer } = render(
      <HealthHistoryBlocks history={null as unknown as HealthCheckResult[]} />
    );
    expect(nullContainer.firstChild).toBeNull();

    const { container: emptyContainer } = render(<HealthHistoryBlocks history={[]} />);
    expect(emptyContainer.firstChild).toBeNull();
  });

  it('renders success/failure blocks with overflow indicator when history exceeds maxBlocks', () => {
    const { container } = render(
      <HealthHistoryBlocks
        history={[
          makeCheck({ success: true }),
          makeCheck({ success: false, timestamp: '2025-01-01T00:01:00.000Z' }),
          makeCheck({ success: true, timestamp: '2025-01-01T00:02:00.000Z' }),
          makeCheck({ success: false, timestamp: '2025-01-01T00:03:00.000Z' }),
        ]}
        maxBlocks={3}
      />
    );

    expect(container.querySelectorAll('div.w-1\\.5.h-3').length).toBe(3);
    const blockTitles = Array.from(container.querySelectorAll('div[title]')).map(
      el => el.getAttribute('title') || ''
    );
    expect(blockTitles.some(title => title.startsWith('Healthy - '))).toBe(true);
    expect(blockTitles.some(title => title.startsWith('Failed - '))).toBe(true);
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('does not render overflow indicator when history length is within maxBlocks', () => {
    const { container } = render(
      <HealthHistoryBlocks
        history={[
          makeCheck({ success: true }),
          makeCheck({ success: false, timestamp: '2025-01-01T00:01:00.000Z' }),
        ]}
        maxBlocks={5}
      />
    );

    expect(container.querySelectorAll('div.w-1\\.5.h-3').length).toBe(2);
    expect(screen.queryByText(/\+\d+/)).not.toBeInTheDocument();
  });
});
