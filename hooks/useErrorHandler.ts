/**
 * Error Handler Hook
 *
 * Centralized error handling using the notification system.
 * Replaces scattered alert() calls with consistent toast notifications.
 * Built on top of useNotify for unified notification access.
 */

import { useCallback } from "react";
import { useNotify } from "./useNotify";
import { ApiError } from "../src/api/client";

interface ErrorHandlerOptions {
  defaultTitle?: string;
  defaultDuration?: number;
}

/**
 * Hook for centralized error handling and success notifications.
 *
 * @example
 * const { handleError, showSuccess, showInfo } = useErrorHandler();
 *
 * try {
 *   await someOperation();
 *   showSuccess('Operation completed');
 * } catch (error) {
 *   handleError(error, 'Operation Failed');
 * }
 */
export const useErrorHandler = (options: ErrorHandlerOptions = {}) => {
  const notify = useNotify();
  const { defaultTitle = "Error", defaultDuration = 5000 } = options;

  /**
   * Handle and display an error notification.
   * Automatically extracts message from ApiError, Error, or string.
   */
  const handleError = useCallback(
    (error: unknown, customTitle?: string) => {
      let message = "An unexpected error occurred";

      if (error instanceof ApiError) {
        message = error.message;
      } else if (error instanceof Error) {
        message = error.message;
      } else if (typeof error === "string") {
        message = error;
      }

      notify.error(customTitle || defaultTitle, message, defaultDuration);
    },
    [notify, defaultTitle, defaultDuration],
  );

  /**
   * Display a success notification.
   */
  const showSuccess = useCallback(
    (message: string, title = "Success") => {
      notify.success(title, message, 3000);
    },
    [notify],
  );

  /**
   * Display an info notification.
   */
  const showInfo = useCallback(
    (message: string, title = "Info") => {
      notify.info(title, message, 4000);
    },
    [notify],
  );

  const showWarning = useCallback(
    (message: string, title = "Warning") => {
      notify.warning(title, message, 6000);
    },
    [notify],
  );

  return { handleError, showSuccess, showInfo, showWarning };
};
