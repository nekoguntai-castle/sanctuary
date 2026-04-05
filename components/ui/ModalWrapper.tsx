/**
 * ModalWrapper Component
 *
 * Shared modal backdrop + container + header pattern used across
 * ~29 modal components. Provides consistent styling, accessibility,
 * and backdrop-click-to-close behavior.
 */

import React from 'react';
import { X } from 'lucide-react';

const MAX_WIDTH_CLASSES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
} as const;

interface ModalWrapperProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: keyof typeof MAX_WIDTH_CLASSES;
  /** Extra classes for the modal container */
  className?: string;
  /** Show border-b under the header (use for modals with distinct content sections) */
  headerBorder?: boolean;
  /** Entry animation class (default: animate-modal-enter) */
  animation?: string;
}

export function ModalWrapper({
  title,
  onClose,
  children,
  maxWidth = 'md',
  className = '',
  headerBorder = false,
  animation = 'animate-modal-enter',
}: ModalWrapperProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`surface-elevated rounded-xl w-full ${MAX_WIDTH_CLASSES[maxWidth]} max-h-[90vh] overflow-y-auto shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 ${animation} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-center justify-between p-6 ${
            headerBorder
              ? 'border-b border-sanctuary-100 dark:border-sanctuary-800'
              : 'pb-0'
          }`}
        >
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 pt-4">{children}</div>
      </div>
    </div>
  );
}
