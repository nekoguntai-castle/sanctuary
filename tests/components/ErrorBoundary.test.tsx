/**
 * Tests for ErrorBoundary component
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../components/ErrorBoundary';

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test error');
  return <div>Child content</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('shows default fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('shows custom ReactNode fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('calls function fallback with error and reset function', () => {
    const fallbackFn = vi.fn((error: Error, reset: () => void) => (
      <div>
        <span>Function fallback: {error.message}</span>
        <button onClick={reset}>Reset</button>
      </div>
    ));

    render(
      <ErrorBoundary fallback={fallbackFn}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(fallbackFn).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Test error' }),
      expect.any(Function)
    );
    expect(screen.getByText('Function fallback: Test error')).toBeInTheDocument();
  });

  it('resets error and re-renders children when "Try again" is clicked', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Re-render with a non-throwing child before clicking reset,
    // so the re-render after state clear does not throw again.
    rerender(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByText('Try again'));

    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('resets error via function fallback reset callback', () => {
    const { rerender } = render(
      <ErrorBoundary
        fallback={(error: Error, reset: () => void) => (
          <div>
            <span>Error: {error.message}</span>
            <button onClick={reset}>Custom reset</button>
          </div>
        )}
      >
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Error: Test error')).toBeInTheDocument();

    rerender(
      <ErrorBoundary
        fallback={(error: Error, reset: () => void) => (
          <div>
            <span>Error: {error.message}</span>
            <button onClick={reset}>Custom reset</button>
          </div>
        )}
      >
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByText('Custom reset'));

    expect(screen.queryByText('Error: Test error')).not.toBeInTheDocument();
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });
});
