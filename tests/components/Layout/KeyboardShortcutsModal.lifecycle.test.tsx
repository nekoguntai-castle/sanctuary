import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardShortcutsModal } from '../../../src/components/Layout/KeyboardShortcutsModal';

describe('KeyboardShortcutsModal lifecycle', () => {
  it('filters console shortcuts and handles close, cancel, backdrop, and focus return', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.append(opener);
    const returnFocusRef = { current: opener };
    const view = render(
      <KeyboardShortcutsModal
        show
        consoleAvailable={false}
        onClose={onClose}
        returnFocusRef={returnFocusRef}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const close = screen.getByRole('button', { name: 'Close keyboard shortcuts' });

    await waitFor(() => expect(close).toHaveFocus());
    expect(screen.getByText('Show keyboard shortcuts')).toBeInTheDocument();
    expect(screen.queryByText('Open AI Console')).not.toBeInTheDocument();

    fireEvent.click(dialog.querySelector('h2')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(
      <KeyboardShortcutsModal
        show={false}
        consoleAvailable
        onClose={onClose}
        returnFocusRef={returnFocusRef}
      />,
    );
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();

    const consoleView = render(
      <KeyboardShortcutsModal show consoleAvailable onClose={vi.fn()} />,
    );
    expect(screen.getByText('Open AI Console')).toBeInTheDocument();
    consoleView.unmount();
  });
});
