/**
 * useErrorHandler Hook Tests
 *
 * Tests for the centralized error handling hook.
 */

import { act, renderHook } from "@testing-library/react";
import { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NotificationProvider,
  useNotifications,
} from "../../src/contexts/NotificationContext";
import { AppNotificationProvider } from "../../src/contexts/AppNotificationContext";
import { useErrorHandler } from "../../src/hooks/useErrorHandler";
import { ApiError } from "../../src/api/client";

// Create a wrapper that provides both notification contexts (useErrorHandler uses useNotify which needs both)
const createWrapper = () => {
  return ({ children }: { children: ReactNode }) => (
    <NotificationProvider>
      <AppNotificationProvider>{children}</AppNotificationProvider>
    </NotificationProvider>
  );
};

describe("useErrorHandler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("should return handleError function", () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useErrorHandler(), { wrapper });

      expect(typeof result.current.handleError).toBe("function");
    });

    it("should return showSuccess function", () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useErrorHandler(), { wrapper });

      expect(typeof result.current.showSuccess).toBe("function");
    });

    it("should return showInfo function", () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useErrorHandler(), { wrapper });

      expect(typeof result.current.showInfo).toBe("function");
    });

    it("should return showWarning function", () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useErrorHandler(), { wrapper });

      expect(typeof result.current.showWarning).toBe("function");
    });
  });

  describe("handleError", () => {
    it("should add error notification for Error instances", () => {
      const wrapper = createWrapper();

      // Use a combined hook to track notifications
      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      const error = new Error("Test error message");

      act(() => {
        result.current.errorHandler.handleError(error);
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0]).toMatchObject({
        type: "error",
        title: "Error",
        message: "Test error message",
      });
    });

    it("should add error notification for ApiError instances", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      const error = new ApiError("API error message", 500);

      act(() => {
        result.current.errorHandler.handleError(error);
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0]).toMatchObject({
        type: "error",
        message: "API error message",
      });
    });

    it("should handle string errors", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.handleError("String error");
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0].message).toBe(
        "String error",
      );
    });

    it("should use default message for unknown error types", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.handleError({ weird: "object" });
      });

      expect(result.current.notifications.notifications[0].message).toBe(
        "An unexpected error occurred",
      );
    });

    it("should use custom title when provided", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.handleError(
          new Error("msg"),
          "Custom Title",
        );
      });

      expect(result.current.notifications.notifications[0].title).toBe(
        "Custom Title",
      );
    });

    it("should respect custom default title from options", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler({ defaultTitle: "My Default" }),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.handleError(new Error("msg"));
      });

      expect(result.current.notifications.notifications[0].title).toBe(
        "My Default",
      );
    });
  });

  describe("showSuccess", () => {
    it("should add success notification", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.showSuccess("Operation completed");
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0]).toMatchObject({
        type: "success",
        title: "Success",
        message: "Operation completed",
      });
    });

    it("should use custom title when provided", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.showSuccess("Done", "All Good");
      });

      expect(result.current.notifications.notifications[0].title).toBe(
        "All Good",
      );
    });
  });

  describe("showInfo", () => {
    it("should add info notification", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.showInfo("Some information");
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0]).toMatchObject({
        type: "info",
        title: "Info",
        message: "Some information",
      });
    });

    it("should use custom title when provided", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.showInfo("Details", "Notice");
      });

      expect(result.current.notifications.notifications[0].title).toBe(
        "Notice",
      );
    });
  });

  describe("showWarning", () => {
    it("should add warning notification", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.showWarning("Check settings");
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0]).toMatchObject({
        type: "warning",
        title: "Warning",
        message: "Check settings",
      });
    });

    it("should use custom title when provided", () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          errorHandler: useErrorHandler(),
          notifications: useNotifications(),
        }),
        { wrapper },
      );

      act(() => {
        result.current.errorHandler.showWarning("Details", "Heads Up");
      });

      expect(result.current.notifications.notifications[0].title).toBe(
        "Heads Up",
      );
    });
  });

  describe("memoization", () => {
    it("should maintain stable handleError reference", () => {
      const wrapper = createWrapper();

      const { result, rerender } = renderHook(() => useErrorHandler(), {
        wrapper,
      });

      const firstRef = result.current.handleError;
      rerender();

      expect(result.current.handleError).toBe(firstRef);
    });

    it("should maintain stable showSuccess reference", () => {
      const wrapper = createWrapper();

      const { result, rerender } = renderHook(() => useErrorHandler(), {
        wrapper,
      });

      const firstRef = result.current.showSuccess;
      rerender();

      expect(result.current.showSuccess).toBe(firstRef);
    });

    it("should maintain stable showInfo reference", () => {
      const wrapper = createWrapper();

      const { result, rerender } = renderHook(() => useErrorHandler(), {
        wrapper,
      });

      const firstRef = result.current.showInfo;
      rerender();

      expect(result.current.showInfo).toBe(firstRef);
    });

    it("should maintain stable showWarning reference", () => {
      const wrapper = createWrapper();

      const { result, rerender } = renderHook(() => useErrorHandler(), {
        wrapper,
      });

      const firstRef = result.current.showWarning;
      rerender();

      expect(result.current.showWarning).toBe(firstRef);
    });
  });
});
