import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnimatedFeeRate } from '../../../components/Dashboard/AnimatedFeeRate';

const expectNoTransitionClass = (container: HTMLElement): void => {
  const span = container.querySelector('span');
  expect(span?.className).not.toContain('number-transition-up');
  expect(span?.className).not.toContain('number-transition-down');
};

const registerRenderingTests = (): void => {
  it('renders value with sat/vB suffix', () => {
    render(<AnimatedFeeRate value="20" />);
    expect(screen.getByText('20 sat/vB')).toBeInTheDocument();
  });
};

const registerDirectionalFlashTests = (): void => {
  it('flashes up when value increases', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<AnimatedFeeRate value="10" />);

    rerender(<AnimatedFeeRate value="20" />);

    const span = container.querySelector('span');
    expect(span?.className).toContain('number-transition-up');

    // Flash clears after 600ms
    act(() => { vi.advanceTimersByTime(600); });
    expect(span?.className).not.toContain('number-transition-up');
    vi.useRealTimers();
  });

  it('flashes down when value decreases', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<AnimatedFeeRate value="30" />);

    rerender(<AnimatedFeeRate value="15" />);

    const span = container.querySelector('span');
    expect(span?.className).toContain('number-transition-down');
    vi.useRealTimers();
  });
};

const registerNoFlashTests = (): void => {
  it('does not flash when value is --- (loading)', () => {
    const { rerender, container } = render(<AnimatedFeeRate value="---" />);

    rerender(<AnimatedFeeRate value="20" />);

    expectNoTransitionClass(container);
  });

  it('does not flash when transitioning to ---', () => {
    const { rerender, container } = render(<AnimatedFeeRate value="20" />);

    rerender(<AnimatedFeeRate value="---" />);

    expectNoTransitionClass(container);
  });

  it('does not flash when values are non-numeric strings', () => {
    const { rerender, container } = render(<AnimatedFeeRate value="loading" />);

    rerender(<AnimatedFeeRate value="pending" />);

    expectNoTransitionClass(container);
  });

  it('does not flash when value is unchanged', () => {
    const { rerender, container } = render(<AnimatedFeeRate value="20" />);

    rerender(<AnimatedFeeRate value="20" />);

    expectNoTransitionClass(container);
  });
};

describe('AnimatedFeeRate', () => {
  registerRenderingTests();
  registerDirectionalFlashTests();
  registerNoFlashTests();
});
