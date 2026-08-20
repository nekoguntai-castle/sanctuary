import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useElementWidth } from '../../src/hooks/useElementWidth';

/**
 * The hook exists because a media query cannot answer "how much room did *this*
 * component get" — the transaction statistics grid renders both full width and
 * inside a narrower column. These tests therefore assert on element geometry,
 * never on the viewport.
 */

const observations: { callback: ResizeObserverCallback; target: Element }[] = [];
const disconnect = vi.fn();

class CapturingResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    observations.push({ callback: this.callback, target });
  }
  unobserve() {}
  disconnect = disconnect;
}

/** jsdom reports every box as 0×0, so width has to be stubbed per element. */
function stubWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
  } as DOMRect);
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  return <div ref={ref} data-testid="probe" data-width={String(width)} />;
}

const measuredWidth = (container: HTMLElement) =>
  container.querySelector('[data-testid="probe"]')?.getAttribute('data-width');

describe('useElementWidth', () => {
  beforeEach(() => {
    observations.length = 0;
    disconnect.mockClear();
    vi.stubGlobal('ResizeObserver', CapturingResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('measures the element before paint, so `null` is never rendered', () => {
    stubWidth(900);

    const { container } = render(<Probe />);

    expect(measuredWidth(container)).toBe('900');
  });

  it('remeasures when the element resizes without the window resizing', () => {
    stubWidth(900);
    const { container } = render(<Probe />);

    // A reveal or a collapsing sibling changes the element's box and fires no
    // window resize event. Only the element observer can notice.
    stubWidth(420);
    act(() => {
      observations[0].callback([], {} as ResizeObserver);
    });

    expect(measuredWidth(container)).toBe('420');
  });

  it('observes the element it was given', () => {
    stubWidth(900);
    const { container } = render(<Probe />);

    expect(observations).toHaveLength(1);
    expect(observations[0].target).toBe(container.querySelector('[data-testid="probe"]'));
  });

  it('falls back to the window resize event where ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    stubWidth(900);
    const { container } = render(<Probe />);

    expect(measuredWidth(container)).toBe('900');

    stubWidth(420);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(measuredWidth(container)).toBe('420');
  });

  it('disconnects the observer on unmount', () => {
    stubWidth(900);
    const { unmount } = render(<Probe />);

    unmount();

    expect(disconnect).toHaveBeenCalled();
  });

  it('reports null when the ref was never attached', () => {
    function Detached() {
      const ref = useRef<HTMLDivElement>(null);
      const width = useElementWidth(ref);
      return <div data-testid="probe" data-width={String(width)} />;
    }

    const { container } = render(<Detached />);

    expect(measuredWidth(container)).toBe('null');
  });
});
