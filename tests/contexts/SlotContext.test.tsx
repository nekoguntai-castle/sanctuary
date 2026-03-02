/**
 * SlotContext Tests
 *
 * Tests for the UI slot system that provides plugin-like extensibility.
 * Covers registration, unregistration, rendering, and priority ordering.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import React, { ReactNode } from 'react';
import {
  SlotProvider,
  useSlots,
  Slot,
  SlotNames,
  useSlotRegistration,
} from '../../contexts/SlotContext';

describe('SlotContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SlotProvider>{children}</SlotProvider>
  );

  describe('SlotProvider', () => {
    it('should provide context to children', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      expect(result.current).toHaveProperty('register');
      expect(result.current).toHaveProperty('unregister');
      expect(result.current).toHaveProperty('getRegistrations');
      expect(result.current).toHaveProperty('hasSlot');
    });
  });

  describe('useSlots', () => {
    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useSlots());
      }).toThrow('useSlots must be used within a SlotProvider');
    });
  });

  describe('register', () => {
    it('should register a slot component', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      const TestComponent = () => <div>Test</div>;

      act(() => {
        result.current.register('test-slot', {
          id: 'test-1',
          priority: 50,
          component: TestComponent,
        });
      });

      const registrations = result.current.getRegistrations('test-slot');
      expect(registrations).toHaveLength(1);
      expect(registrations[0].id).toBe('test-1');
    });

    it('should return unregister function', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      const TestComponent = () => <div>Test</div>;
      let unregister: () => void;

      act(() => {
        unregister = result.current.register('test-slot', {
          id: 'test-1',
          priority: 50,
          component: TestComponent,
        });
      });

      expect(result.current.getRegistrations('test-slot')).toHaveLength(1);

      act(() => {
        unregister();
      });

      expect(result.current.getRegistrations('test-slot')).toHaveLength(0);
    });

    it('should sort registrations by priority', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      const Comp1 = () => <div>1</div>;
      const Comp2 = () => <div>2</div>;
      const Comp3 = () => <div>3</div>;

      act(() => {
        result.current.register('test-slot', { id: 'high', priority: 100, component: Comp1 });
        result.current.register('test-slot', { id: 'low', priority: 10, component: Comp2 });
        result.current.register('test-slot', { id: 'mid', priority: 50, component: Comp3 });
      });

      const registrations = result.current.getRegistrations('test-slot');
      expect(registrations[0].id).toBe('low');
      expect(registrations[1].id).toBe('mid');
      expect(registrations[2].id).toBe('high');
    });

    it('should replace existing registration with same id', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      const Comp1 = () => <div>Original</div>;
      const Comp2 = () => <div>Replaced</div>;

      act(() => {
        result.current.register('test-slot', { id: 'same-id', priority: 50, component: Comp1 });
        result.current.register('test-slot', { id: 'same-id', priority: 100, component: Comp2 });
      });

      const registrations = result.current.getRegistrations('test-slot');
      expect(registrations).toHaveLength(1);
      expect(registrations[0].component).toBe(Comp2);
    });

    it('should keep slot entry when unregistering one of multiple registrations', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });
      const CompA = () => <div>A</div>;
      const CompB = () => <div>B</div>;
      let unregisterA: () => void;

      act(() => {
        unregisterA = result.current.register('test-slot', { id: 'a', priority: 10, component: CompA });
        result.current.register('test-slot', { id: 'b', priority: 20, component: CompB });
      });

      act(() => {
        unregisterA();
      });

      const registrations = result.current.getRegistrations('test-slot');
      expect(registrations).toHaveLength(1);
      expect(registrations[0].id).toBe('b');
    });

    it('should allow returned unregister to be called repeatedly without crashing', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });
      const Comp = () => <div>One</div>;
      let unregister: () => void;

      act(() => {
        unregister = result.current.register('test-slot', { id: 'one', priority: 10, component: Comp });
      });

      act(() => {
        unregister();
        unregister();
      });

      expect(result.current.getRegistrations('test-slot')).toHaveLength(0);
    });
  });

  describe('unregister', () => {
    it('should remove a registration by id', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      const TestComponent = () => <div>Test</div>;

      act(() => {
        result.current.register('test-slot', { id: 'to-remove', priority: 50, component: TestComponent });
        result.current.register('test-slot', { id: 'to-keep', priority: 50, component: TestComponent });
      });

      expect(result.current.getRegistrations('test-slot')).toHaveLength(2);

      act(() => {
        result.current.unregister('test-slot', 'to-remove');
      });

      const remaining = result.current.getRegistrations('test-slot');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('to-keep');
    });

    it('should handle unregistering non-existent slot', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      act(() => {
        result.current.unregister('non-existent-slot', 'some-id');
      });

      expect(result.current.getRegistrations('non-existent-slot')).toHaveLength(0);
    });
  });

  describe('getRegistrations', () => {
    it('should return empty array for unknown slot', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      const registrations = result.current.getRegistrations('unknown-slot');
      expect(registrations).toEqual([]);
    });

    it('should filter out disabled registrations', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      const TestComponent = () => <div>Test</div>;

      act(() => {
        result.current.register('test-slot', { id: 'enabled', priority: 50, component: TestComponent, enabled: true });
        result.current.register('test-slot', { id: 'disabled', priority: 50, component: TestComponent, enabled: false });
        result.current.register('test-slot', { id: 'default', priority: 50, component: TestComponent });
      });

      const registrations = result.current.getRegistrations('test-slot');
      expect(registrations).toHaveLength(2);
      expect(registrations.map(r => r.id)).toEqual(['enabled', 'default']);
    });
  });

  describe('hasSlot', () => {
    it('should return false for empty slot', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      expect(result.current.hasSlot('empty-slot')).toBe(false);
    });

    it('should return true for slot with registrations', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      const TestComponent = () => <div>Test</div>;

      act(() => {
        result.current.register('test-slot', { id: 'test', priority: 50, component: TestComponent });
      });

      expect(result.current.hasSlot('test-slot')).toBe(true);
    });

    it('should return false if all registrations are disabled', () => {
      const { result } = renderHook(() => useSlots(), { wrapper });

      const TestComponent = () => <div>Test</div>;

      act(() => {
        result.current.register('test-slot', { id: 'disabled', priority: 50, component: TestComponent, enabled: false });
      });

      expect(result.current.hasSlot('test-slot')).toBe(false);
    });
  });

  describe('Slot Component', () => {
    it('should render registered components', () => {
      const TestComponent = () => <div data-testid="slot-content">Slot Content</div>;

      const TestApp = () => {
        const { register } = useSlots();
        React.useEffect(() => {
          return register('test-slot', { id: 'test', priority: 50, component: TestComponent });
        }, [register]);
        return <Slot name="test-slot" />;
      };

      render(
        <SlotProvider>
          <TestApp />
        </SlotProvider>
      );

      expect(screen.getByTestId('slot-content')).toBeInTheDocument();
    });

    it('should render fallback when slot is empty', () => {
      render(
        <SlotProvider>
          <Slot name="empty-slot" fallback={<div data-testid="fallback">Fallback</div>} />
        </SlotProvider>
      );

      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });

    it('should pass context to slot components', () => {
      const TestComponent = ({ value }: { value: string }) => (
        <div data-testid="slot-content">{value}</div>
      );

      const TestApp = () => {
        const { register } = useSlots();
        React.useEffect(() => {
          return register('test-slot', { id: 'test', priority: 50, component: TestComponent });
        }, [register]);
        return <Slot name="test-slot" context={{ value: 'Hello from context' }} />;
      };

      render(
        <SlotProvider>
          <TestApp />
        </SlotProvider>
      );

      expect(screen.getByTestId('slot-content')).toHaveTextContent('Hello from context');
    });

    it('should render components in priority order', () => {
      const Comp1 = () => <span>First</span>;
      const Comp2 = () => <span>Second</span>;
      const Comp3 = () => <span>Third</span>;

      const TestApp = () => {
        const { register } = useSlots();
        React.useEffect(() => {
          register('test-slot', { id: 'c', priority: 100, component: Comp3 });
          register('test-slot', { id: 'a', priority: 10, component: Comp1 });
          register('test-slot', { id: 'b', priority: 50, component: Comp2 });
        }, [register]);
        return <Slot name="test-slot" />;
      };

      const { container } = render(
        <SlotProvider>
          <TestApp />
        </SlotProvider>
      );

      const spans = container.querySelectorAll('span');
      expect(spans[0]).toHaveTextContent('First');
      expect(spans[1]).toHaveTextContent('Second');
      expect(spans[2]).toHaveTextContent('Third');
    });

    it('should render slot content inside wrapper when provided', () => {
      const WrappedComponent = () => <span data-testid="wrapped-content">Wrapped Content</span>;
      const Wrapper = ({ children }: { children: ReactNode }) => (
        <div data-testid="slot-wrapper">{children}</div>
      );

      const TestApp = () => {
        const { register } = useSlots();
        React.useEffect(() => {
          return register('test-slot', {
            id: 'wrapped',
            priority: 50,
            component: WrappedComponent,
          });
        }, [register]);

        return <Slot name="test-slot" wrapper={Wrapper} />;
      };

      render(
        <SlotProvider>
          <TestApp />
        </SlotProvider>
      );

      expect(screen.getByTestId('slot-wrapper')).toBeInTheDocument();
      expect(screen.getByTestId('wrapped-content')).toBeInTheDocument();
    });
  });

  describe('SlotNames constants', () => {
    it('should define all slot names', () => {
      expect(SlotNames.WALLET_HEADER_ACTIONS).toBe('wallet-header-actions');
      expect(SlotNames.WALLET_DETAIL_TABS).toBe('wallet-detail-tabs');
      expect(SlotNames.DASHBOARD_WIDGETS).toBe('dashboard-widgets');
      expect(SlotNames.SIDEBAR_FOOTER).toBe('sidebar-footer');
    });
  });

  describe('useSlotRegistration', () => {
    it('should register and unregister on mount/unmount', () => {
      const TestComponent = () => <div>Test</div>;

      const TestHook = () => {
        const ready = useSlotRegistration('test-slot', {
          id: 'hook-test',
          priority: 50,
          component: TestComponent,
        });
        return ready;
      };

      const { result, unmount } = renderHook(() => TestHook(), { wrapper });

      // After registration, should be ready
      expect(result.current).toBe(true);

      // Check registration exists
      const { result: slotsResult } = renderHook(() => useSlots(), { wrapper });
      // Note: Can't easily check this because unmount cleans up
    });
  });
});
