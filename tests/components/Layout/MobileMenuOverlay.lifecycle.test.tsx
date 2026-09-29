import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MobileMenuOverlay } from '../../../src/components/Layout/MobileMenuOverlay';

function OverlayHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [isOpen, setIsOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();

  return (
    <>
      <button ref={triggerRef}>Open navigation</button>
      <button onClick={() => navigate('/next')}>Trigger programmatic route change</button>
      <main ref={mainRef} tabIndex={-1}>Main content</main>
      <MobileMenuOverlay
        isOpen={isOpen}
        onClose={() => { onClose(); setIsOpen(false); }}
        onNavigate={() => setIsOpen(false)}
        sidebarContent={<nav><a href="/next">Next route</a></nav>}
        triggerRef={triggerRef}
        returnFocusRef={returnFocusRef}
        mainRef={mainRef}
      />
    </>
  );
}

describe('MobileMenuOverlay lifecycle', () => {
  it('closes on programmatic route changes and restores focus to main', async () => {
    render(<MemoryRouter><OverlayHarness /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Trigger programmatic route change' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Main navigation' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });

  it('closes on Escape cancellation and backdrop click, but ignores clicks inside the panel', () => {
    const onClose = vi.fn();
    const firstView = render(
      <MemoryRouter><OverlayHarness onClose={onClose} /></MemoryRouter>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Main navigation' });
    fireEvent.click(screen.getByTestId('mobile-sidebar-panel'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();

    firstView.unmount();
    render(<MemoryRouter><OverlayHarness onClose={onClose} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('dialog', { name: 'Main navigation' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
