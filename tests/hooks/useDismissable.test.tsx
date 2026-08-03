import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useDismissable } from '../../src/hooks/useDismissable';

function Probe({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(isOpen, ref, onClose);
  return (
    <div>
      <div ref={ref} data-testid="inside">
        <button data-testid="inside-btn">inside</button>
      </div>
      <button data-testid="outside-btn">outside</button>
    </div>
  );
}

// The container ref is never attached, so containerRef.current stays null —
// exercises the falsy short-circuit of `containerRef.current && ...`.
function DetachedProbe({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(true, ref, onClose);
  return <button data-testid="outside-btn">outside</button>;
}

describe('useDismissable', () => {
  it('calls onClose on an outside mousedown when open', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Probe isOpen onClose={onClose} />);

    fireEvent.mouseDown(getByTestId('outside-btn'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on a mousedown inside the container', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Probe isOpen onClose={onClose} />);

    fireEvent.mouseDown(getByTestId('inside-btn'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('is a no-op on mousedown when the container ref is unattached', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<DetachedProbe onClose={onClose} />);

    fireEvent.mouseDown(getByTestId('outside-btn'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape when open and ignores other keys', () => {
    const onClose = vi.fn();
    render(<Probe isOpen onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('attaches no listeners while closed', () => {
    const onClose = vi.fn();
    render(<Probe isOpen={false} onClose={onClose} />);

    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes its listeners when it transitions to closed and on unmount', () => {
    const onClose = vi.fn();
    const { rerender, unmount } = render(<Probe isOpen onClose={onClose} />);

    // open -> closed runs both effect cleanups
    rerender(<Probe isOpen={false} onClose={onClose} />);

    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    unmount();
  });
});
