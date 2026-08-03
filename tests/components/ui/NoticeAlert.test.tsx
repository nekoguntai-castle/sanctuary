import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NoticeAlert } from '../../../src/components/ui/NoticeAlert';

describe('NoticeAlert', () => {
  it('renders nothing when message is missing or empty', () => {
    const { container, rerender } = render(<NoticeAlert message={null} />);
    expect(container.firstChild).toBeNull();

    rerender(<NoticeAlert message="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the notice message with caller-provided classes', () => {
    render(<NoticeAlert message="Check your email" className="text-center" />);

    const alert = screen.getByText('Check your email');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveClass('text-center');
    expect(alert).toHaveClass('bg-emerald-50');
  });

  it('renders warning notices with the shared warning palette', () => {
    render(<NoticeAlert message="Share carefully" tone="warning" />);

    const alert = screen.getByText('Share carefully');
    expect(alert).toHaveClass('bg-amber-50');
    expect(alert).toHaveClass('text-amber-700');
    expect(alert).not.toHaveClass('bg-emerald-50');
  });
});
