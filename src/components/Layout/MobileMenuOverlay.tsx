import React, { useRef } from 'react';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useNativeDialogLifecycle } from './useNativeDialogLifecycle';

interface MobileMenuOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: () => void;
  sidebarContent: React.ReactNode;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  mainRef: React.RefObject<HTMLElement | null>;
}

export const MobileMenuOverlay: React.FC<MobileMenuOverlayProps> = ({
  isOpen,
  onClose,
  onNavigate,
  sidebarContent,
  triggerRef,
  returnFocusRef,
  mainRef,
}) => {
  const location = useLocation();
  const routeIdentity = `${location.pathname}${location.search}${location.hash}:${location.key}`;
  const previousRouteRef = useRef(routeIdentity);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useNativeDialogLifecycle({ isOpen, dialogRef, initialFocusRef: closeRef, returnFocusRef });

  useEffect(() => {
    if (previousRouteRef.current === routeIdentity) return;
    previousRouteRef.current = routeIdentity;
    if (isOpen) {
      returnFocusRef.current = mainRef.current;
      onNavigate();
    }
  }, [isOpen, mainRef, onNavigate, returnFocusRef, routeIdentity]);

  if (!isOpen) return <span id="mobile-sidebar-dialog" hidden aria-hidden="true" />;

  const handlePanelClick: React.MouseEventHandler<HTMLDialogElement> = (event) => {
    if (event.target === event.currentTarget) {
      onClose();
      returnFocusRef.current = triggerRef.current;
      return;
    }
    if (event.target instanceof Element && event.target.closest('a[href]')) {
      returnFocusRef.current = mainRef.current;
      onNavigate();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      id="mobile-sidebar-dialog"
      aria-label="Main navigation"
      data-testid="mobile-sidebar-overlay"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={handlePanelClick}
      className="md:hidden fixed inset-0 z-40 m-0 h-screen max-h-none w-screen max-w-none border-0 bg-black/50 p-0 backdrop:backdrop-blur-sm"
    >
      <div
        className="relative flex h-full w-full max-w-xs flex-col surface-elevated"
        data-testid="mobile-sidebar-panel"
      >
        <button
          ref={closeRef}
          type="button"
          aria-label="Close navigation"
          onClick={() => { returnFocusRef.current = triggerRef.current; onClose(); }}
          className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md text-sanctuary-500 hover:bg-sanctuary-100 dark:text-sanctuary-400 dark:hover:bg-sanctuary-800 focus-contrast"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        {sidebarContent}
      </div>
    </dialog>
  );
};
