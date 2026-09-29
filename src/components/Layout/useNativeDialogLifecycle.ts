import { useEffect, useRef, type RefObject } from 'react';

interface NativeDialogLifecycleOptions {
  isOpen: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef: RefObject<HTMLElement | null>;
}

export function useNativeDialogLifecycle({
  isOpen,
  dialogRef,
  initialFocusRef,
  returnFocusRef,
}: NativeDialogLifecycleOptions): void {
  const frameRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      generationRef.current += 1;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    if (!dialog.open) dialog.showModal();
    const generation = ++generationRef.current;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      if (generationRef.current !== generation || disposedRef.current) return;
      const initialFocus = initialFocusRef?.current;
      if (initialFocus?.isConnected) initialFocus.focus();
      frameRef.current = null;
    });

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      if (dialog.open) dialog.close();
      if (disposedRef.current) return;
      const restoreGeneration = ++generationRef.current;
      frameRef.current = requestAnimationFrame(() => {
        if (generationRef.current !== restoreGeneration || disposedRef.current) return;
        const returnFocus = returnFocusRef.current;
        if (returnFocus?.isConnected) returnFocus.focus();
        frameRef.current = null;
      });
    };
  }, [dialogRef, initialFocusRef, isOpen, returnFocusRef]);
}
