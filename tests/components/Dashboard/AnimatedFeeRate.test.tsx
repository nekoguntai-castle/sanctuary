import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnimatedFeeRate } from '../../../src/components/Dashboard/AnimatedFeeRate';

const expectNoTransitionClass = (container: HTMLElement): void => {
  const span = container.querySelector('span');
  expect(span?.className).not.toContain('number-transition-up');
  expect(span?.className).not.toContain('number-transition-down');
};

const registerRenderingTests = (): void => {
  it('renders the bare figure, leaving the unit to the card', () => {
    render(<AnimatedFeeRate value="20" />);
    // The unit is stated once on the card, not repeated per tier.
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.queryByText('20 sat/vB')).not.toBeInTheDocument();
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

  it('compares against the value it last showed, not the one it first showed', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<AnimatedFeeRate value="10" />);

    // 10 -> 20 rises, so this one flashes up and clears.
    rerender(<AnimatedFeeRate value="20" />);
    act(() => { vi.advanceTimersByTime(600); });

    // 20 -> 15 falls. Read against the mounted 10 it would look like a rise,
    // which is what happened while the previous value stopped advancing once a
    // flash had fired.
    rerender(<AnimatedFeeRate value="15" />);

    const span = container.querySelector('span');
    expect(span?.className).toContain('number-transition-down');
    expect(span?.className).not.toContain('number-transition-up');
    vi.useRealTimers();
  });

  it('keeps tracking direction across several changes', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<AnimatedFeeRate value="10" />);
    const span = () => container.querySelector('span');

    for (const [next, expected] of [
      ['20', 'up'],
      ['30', 'up'],
      ['25', 'down'],
      ['26', 'up'],
      ['5', 'down'],
    ] as const) {
      rerender(<AnimatedFeeRate value={next} />);
      expect(span()?.className).toContain(`number-transition-${expected}`);
      act(() => { vi.advanceTimersByTime(600); });
    }

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

  it('clears an in-flight flash when the rate stops being a number', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<AnimatedFeeRate value="10" />);

    rerender(<AnimatedFeeRate value="20" />);
    expect(container.querySelector('span')?.className).toContain('number-transition-up');

    // Going back to the loading placeholder cancels the pending clear-timer, so
    // without an explicit reset the figure keeps its flash colour for good.
    rerender(<AnimatedFeeRate value="---" />);
    act(() => { vi.advanceTimersByTime(600); });

    expectNoTransitionClass(container);
    vi.useRealTimers();
  });
};

describe('AnimatedFeeRate', () => {
  registerRenderingTests();
  registerDirectionalFlashTests();
  registerNoFlashTests();
});
