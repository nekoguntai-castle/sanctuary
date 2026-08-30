import { render, screen } from '@testing-library/react';
import { DashboardSkeleton } from '../../../src/components/ui/Skeleton';

describe('DashboardSkeleton', () => {
  it('matches the current dashboard section order', () => {
    const { container } = render(<DashboardSkeleton />);

    const sections = Array.from(
      container.querySelectorAll<HTMLElement>('[data-skeleton-section]'),
    ).map((section) => section.dataset.skeletonSection);

    expect(sections).toEqual([
      'period',
      'balance',
      'wallets',
      'activity',
      'telemetry',
      'mempool',
    ]);
    expect(screen.getByTestId('dashboard-skeleton')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('uses the dashboard telemetry breakpoints', () => {
    const { container } = render(<DashboardSkeleton />);
    const telemetry = container.querySelector(
      '[data-skeleton-section="telemetry"]',
    );

    expect(telemetry).toHaveClass(
      'grid-cols-1',
      'sm:grid-cols-2',
      'lg:grid-cols-3',
    );
  });
});
