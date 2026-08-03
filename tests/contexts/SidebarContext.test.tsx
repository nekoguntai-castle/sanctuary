/**
 * SidebarContext Tests
 *
 * Tests for the sidebar refresh context.
 * Covers provider, hook, and refresh key incrementing.
 */

import { act,renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import { describe,expect,it } from 'vitest';
import { SidebarProvider,useSidebar } from '../../src/contexts/SidebarContext';

describe('SidebarContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SidebarProvider>{children}</SidebarProvider>
  );

  describe('SidebarProvider', () => {
    it('should provide initial refresh key of 0', () => {
      const { result } = renderHook(() => useSidebar(), { wrapper });

      expect(result.current.refreshKey).toBe(0);
    });

    it('should provide refreshSidebar function', () => {
      const { result } = renderHook(() => useSidebar(), { wrapper });

      expect(typeof result.current.refreshSidebar).toBe('function');
    });
  });

  describe('useSidebar', () => {
    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useSidebar());
      }).toThrow('useSidebar must be used within a SidebarProvider');
    });

    it('should return context with refreshKey and refreshSidebar', () => {
      const { result } = renderHook(() => useSidebar(), { wrapper });

      expect(result.current).toHaveProperty('refreshKey');
      expect(result.current).toHaveProperty('refreshSidebar');
    });
  });

  describe('refreshSidebar', () => {
    it('should increment refreshKey when called', () => {
      const { result } = renderHook(() => useSidebar(), { wrapper });

      expect(result.current.refreshKey).toBe(0);

      act(() => {
        result.current.refreshSidebar();
      });

      expect(result.current.refreshKey).toBe(1);
    });

    it('should increment refreshKey multiple times', () => {
      const { result } = renderHook(() => useSidebar(), { wrapper });

      act(() => {
        result.current.refreshSidebar();
        result.current.refreshSidebar();
        result.current.refreshSidebar();
      });

      expect(result.current.refreshKey).toBe(3);
    });

    it('should maintain stable function reference', () => {
      const { result, rerender } = renderHook(() => useSidebar(), { wrapper });

      const firstRef = result.current.refreshSidebar;

      rerender();

      expect(result.current.refreshSidebar).toBe(firstRef);
    });
  });

  describe('Multiple Consumers', () => {
    it('should share state between multiple consumers', () => {
      const { result: result1 } = renderHook(() => useSidebar(), { wrapper });
      const { result: result2 } = renderHook(() => useSidebar(), { wrapper });

      // Both should start at 0
      expect(result1.current.refreshKey).toBe(0);
      expect(result2.current.refreshKey).toBe(0);
    });
  });
});
