import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNativeDialogLifecycle } from '../../../src/components/Layout/useNativeDialogLifecycle';

function Harness({ isOpen }: { isOpen: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  useNativeDialogLifecycle({ isOpen, dialogRef, initialFocusRef, returnFocusRef });
  return (
    <>
      <button ref={returnFocusRef}>Trigger</button>
      <dialog ref={dialogRef}>
        <button ref={initialFocusRef}>Initial focus</button>
      </dialog>
    </>
  );
}

function EdgeHarness({
  isOpen,
  includeDialog = true,
  preOpened = false,
  includeInitialFocus = true,
  connectedFocusTargets = true,
}: {
  isOpen: boolean;
  includeDialog?: boolean;
  preOpened?: boolean;
  includeInitialFocus?: boolean;
  connectedFocusTargets?: boolean;
}) {
  const detachedReturnFocus = useRef(document.createElement('button'));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  useNativeDialogLifecycle({
    isOpen,
    dialogRef,
    initialFocusRef: includeInitialFocus ? initialFocusRef : undefined,
    returnFocusRef: connectedFocusTargets ? returnFocusRef : detachedReturnFocus,
  });
  return (
    <>
      {connectedFocusTargets ? <button ref={returnFocusRef}>Connected trigger</button> : null}
      {includeDialog ? (
        <dialog ref={dialogRef} open={preOpened}>
          {includeInitialFocus && <button ref={initialFocusRef}>Edge initial focus</button>}
        </dialog>
      ) : null}
      {!includeDialog && <span>Dialog ref stays empty</span>}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useNativeDialogLifecycle', () => {
  it('keeps focus scheduling active after StrictMode replays mounted effects', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    render(<StrictMode><Harness isOpen /></StrictMode>);

    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Initial focus' }));
  });

  it('opens modally, focuses content, and restores the connected return target', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    const { rerender } = render(<Harness isOpen />);

    expect(showModal).toHaveBeenCalledOnce();
    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Initial focus' }));

    rerender(<Harness isOpen={false} />);
    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Trigger' }));
  });

  it('cancels stale focus restoration when reopened and cancels owned frames on unmount', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    const { rerender, unmount } = render(<Harness isOpen />);
    rerender(<Harness isOpen={false} />);
    rerender(<Harness isOpen />);
    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Initial focus' }));

    unmount();
    expect(frames.size).toBe(0);
  });

  it('ignores a stale initial-focus callback after the dialog is reopened', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    const view = render(<Harness isOpen />);
    const staleInitialFocus = [...frames.values()][0];

    view.rerender(<Harness isOpen={false} />);
    view.rerender(<Harness isOpen />);
    act(() => staleInitialFocus(0));

    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Initial focus' }));
  });

  it('handles an unavailable or pre-opened dialog and disconnected focus targets', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');

    const absent = render(<EdgeHarness isOpen includeDialog={false} />);
    expect(showModal).not.toHaveBeenCalled();
    absent.unmount();

    const preOpened = render(
      <EdgeHarness isOpen preOpened includeInitialFocus={false} connectedFocusTargets={false} />,
    );
    const dialog = document.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(showModal).not.toHaveBeenCalled();
    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    dialog.removeAttribute('open');
    preOpened.rerender(
      <EdgeHarness isOpen={false} preOpened includeInitialFocus={false} connectedFocusTargets={false} />,
    );
    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(dialog);
  });

  it('does not restore focus from a stale scheduled callback after unmount', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    const view = render(<Harness isOpen />);
    view.rerender(<Harness isOpen={false} />);
    const staleRestore = [...frames.values()][0];
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    view.unmount();
    act(() => staleRestore(0));
    expect(trigger).not.toHaveFocus();
  });
});
