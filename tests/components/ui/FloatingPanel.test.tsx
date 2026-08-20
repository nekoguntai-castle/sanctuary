import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingPanel } from '../../../src/components/ui/FloatingPanel';

vi.mock('lucide-react', () => ({
  PanelBottomClose: () => <span data-testid="dock-icon" />,
  X: () => <span data-testid="close-icon" />,
}));

const panel = () => screen.getByTestId('floating-panel');
const header = () => screen.getByTestId('floating-panel-header');
const position = () => ({
  left: panel().style.left,
  top: panel().style.top,
  width: panel().style.width,
  height: panel().style.height,
});

function renderPanel(overrides: Partial<Parameters<typeof FloatingPanel>[0]> = {}) {
  const onDock = vi.fn();
  const onClose = vi.fn();
  render(
    <FloatingPanel
      storageId="txid-1"
      index={0}
      title="Received abc123...def456"
      label="Received abc123...def456"
      onDock={onDock}
      onClose={onClose}
      {...overrides}
    >
      <p>panel body</p>
    </FloatingPanel>,
  );
  return { onDock, onClose };
}

/** jsdom implements neither capture method; the component must not depend on them. */
function stubPointerCapture() {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
}

const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  fireEvent.pointerDown(header(), { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(header(), { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(header(), { pointerId: 1 });
};

describe('FloatingPanel', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    stubPointerCapture();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  it('renders into the document body, outside the list it was detached from', () => {
    renderPanel();

    expect(panel().parentElement).toBe(document.body);
    expect(screen.getByText('panel body')).toBeInTheDocument();
  });

  it('is a non-modal dialog: the list behind it stays usable', () => {
    // The reason to detach a transaction is to read it *while* working the
    // list, so there is no backdrop and no focus trap.
    renderPanel();

    expect(panel()).toHaveAttribute('role', 'dialog');
    expect(panel()).toHaveAttribute('aria-label', 'Received abc123...def456');
    expect(panel()).not.toHaveAttribute('aria-modal');
  });

  it('moves with the pointer', () => {
    renderPanel();
    const before = position();

    drag({ x: 200, y: 200 }, { x: 260, y: 240 });

    expect(position().left).toBe(`${parseInt(before.left, 10) + 60}px`);
    expect(position().top).toBe(`${parseInt(before.top, 10) + 40}px`);
  });

  it('tracks a drag across several moves', () => {
    renderPanel();
    const before = position();

    fireEvent.pointerDown(header(), { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(header(), { pointerId: 1, clientX: 220, clientY: 210 });
    fireEvent.pointerMove(header(), { pointerId: 1, clientX: 240, clientY: 230 });
    fireEvent.pointerUp(header(), { pointerId: 1 });

    expect(position().left).toBe(`${parseInt(before.left, 10) + 40}px`);
  });

  it('stops moving once the pointer is released', () => {
    renderPanel();
    drag({ x: 200, y: 200 }, { x: 240, y: 200 });
    const afterDrag = position();

    fireEvent.pointerMove(header(), { pointerId: 1, clientX: 900, clientY: 900 });

    expect(position()).toEqual(afterDrag);
  });

  it('stops moving when the gesture is cancelled', () => {
    renderPanel();
    fireEvent.pointerDown(header(), { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerCancel(header(), { pointerId: 1 });
    const afterCancel = position();

    fireEvent.pointerMove(header(), { pointerId: 1, clientX: 900, clientY: 900 });

    expect(position()).toEqual(afterCancel);
  });

  it('ignores a non-primary button, which belongs to the context menu', () => {
    renderPanel();
    const before = position();

    fireEvent.pointerDown(header(), { button: 2, pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(header(), { pointerId: 1, clientX: 400, clientY: 400 });

    expect(position()).toEqual(before);
  });

  it('cannot be dragged off the top edge, where nothing is left to grab', () => {
    renderPanel();

    drag({ x: 200, y: 200 }, { x: 200, y: -900 });

    expect(position().top).toBe('0px');
  });

  it('resizes from its corner', () => {
    renderPanel();
    const before = position();
    const handle = screen.getByTestId('floating-panel-resize');

    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 500, clientY: 600 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 560, clientY: 660 });
    fireEvent.pointerUp(handle, { pointerId: 2 });

    expect(position().width).toBe(`${parseInt(before.width, 10) + 60}px`);
    expect(position().height).toBe(`${parseInt(before.height, 10) + 60}px`);
  });

  it('moves by the arrow keys, for anyone not using a pointer', () => {
    renderPanel();
    const before = position();

    header().focus();
    fireEvent.keyDown(header(), { key: 'ArrowRight' });
    fireEvent.keyDown(header(), { key: 'ArrowDown' });
    fireEvent.keyDown(header(), { key: 'ArrowLeft' });
    fireEvent.keyDown(header(), { key: 'ArrowUp' });
    fireEvent.keyDown(header(), { key: 'ArrowDown' });

    expect(position().left).toBe(before.left);
    expect(position().top).toBe(`${parseInt(before.top, 10) + 24}px`);
  });

  it('leaves other keys to the browser', () => {
    renderPanel();
    const before = position();

    fireEvent.keyDown(header(), { key: 'Enter' });

    expect(position()).toEqual(before);
  });

  it('docks and closes from its header controls', async () => {
    const user = userEvent.setup();
    const { onDock, onClose } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Dock Received abc123...def456' }));
    await user.click(screen.getByRole('button', { name: 'Close Received abc123...def456' }));

    expect(onDock).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stacks later panels above earlier ones', () => {
    renderPanel({ index: 3 });

    expect(panel().style.zIndex).toBe('43');
  });

  it('drags where pointer capture is unavailable', () => {
    // Not every environment implements it; the drag must not depend on it.
    // @ts-expect-error -- removing a DOM method for the unsupported-environment case
    delete Element.prototype.setPointerCapture;
    // @ts-expect-error -- as above
    delete Element.prototype.releasePointerCapture;
    renderPanel();
    const before = position();

    drag({ x: 200, y: 200 }, { x: 250, y: 200 });

    expect(position().left).toBe(`${parseInt(before.left, 10) + 50}px`);
  });
});
