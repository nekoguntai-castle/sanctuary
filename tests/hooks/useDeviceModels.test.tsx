/**
 * useDeviceModels Hook Tests
 *
 * Tests for the device models hook that manages fetching and filtering
 * hardware device models from the API.
 */

import { act,renderHook,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { HardwareDeviceModel } from '../../src/types';

// Mock getDeviceModels API
const mockGetDeviceModels = vi.fn();

vi.mock('../../src/api/devices', () => ({
  getDeviceModels: () => mockGetDeviceModels(),
}));

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks
import { useDeviceModels } from '../../src/hooks/useDeviceModels';

// Test data
const mockModels: HardwareDeviceModel[] = [
  {
    id: '1',
    name: 'Coldcard Mk4',
    slug: 'coldcard-mk4',
    manufacturer: 'Coinkite',
    connectivity: ['usb', 'microsd'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['native_segwit', 'nested_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'OLED',
    integrationTested: true,
    discontinued: false,
  },
  {
    id: '2',
    name: 'Ledger Nano X',
    slug: 'ledger-nano-x',
    manufacturer: 'Ledger',
    connectivity: ['usb', 'bluetooth'],
    secureElement: true,
    openSource: false,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['native_segwit', 'nested_segwit', 'taproot', 'legacy'],
    hasScreen: true,
    screenType: 'LCD',
    integrationTested: true,
    discontinued: false,
  },
  {
    id: '3',
    name: 'Trezor Model T',
    slug: 'trezor-model-t',
    manufacturer: 'SatoshiLabs',
    connectivity: ['usb'],
    secureElement: false,
    openSource: true,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['native_segwit', 'nested_segwit', 'taproot', 'legacy'],
    hasScreen: true,
    screenType: 'Touchscreen',
    integrationTested: true,
    discontinued: false,
  },
  {
    id: '4',
    name: 'Coldcard Q',
    slug: 'coldcard-q',
    manufacturer: 'Coinkite',
    connectivity: ['usb', 'nfc', 'microsd'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['native_segwit', 'nested_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'LCD',
    integrationTested: true,
    discontinued: false,
  },
];

describe('useDeviceModels', () => {
  const renderWithPendingFetch = () => {
    mockGetDeviceModels.mockImplementation(() => new Promise(() => {}));
    return renderHook(() => useDeviceModels());
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeviceModels.mockResolvedValue(mockModels);
  });

  describe('Initial State', () => {
    it('should start with loading true', () => {
      const { result } = renderWithPendingFetch();

      expect(result.current.loading).toBe(true);
    });

    it('should have empty device models initially', () => {
      const { result } = renderWithPendingFetch();

      expect(result.current.deviceModels).toEqual([]);
    });

    it('should have no error initially', () => {
      const { result } = renderWithPendingFetch();

      expect(result.current.error).toBeNull();
    });

    it('should have no selected manufacturer initially', () => {
      const { result } = renderWithPendingFetch();

      expect(result.current.selectedManufacturer).toBeNull();
    });

    it('should have empty search query initially', () => {
      const { result } = renderWithPendingFetch();

      expect(result.current.searchQuery).toBe('');
    });
  });

  describe('Fetching Models', () => {
    it('should fetch device models on mount', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetDeviceModels).toHaveBeenCalledTimes(1);
      expect(result.current.deviceModels).toEqual(mockModels);
    });

    it('should set loading false after fetch', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should extract unique manufacturers sorted alphabetically', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.manufacturers).toEqual([
        'Coinkite',
        'Ledger',
        'SatoshiLabs',
      ]);
    });

    it('should have all models as filtered models when no filters applied', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.filteredModels).toEqual(mockModels);
    });
  });

  describe('Error Handling', () => {
    it('should set error on fetch failure', async () => {
      mockGetDeviceModels.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe(
        'Failed to load device models. Please try again.'
      );
      expect(result.current.deviceModels).toEqual([]);
    });

    it('should set loading false even on error', async () => {
      mockGetDeviceModels.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('Manufacturer Filtering', () => {
    it('should filter models by selected manufacturer', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSelectedManufacturer('Coinkite');
      });

      expect(result.current.filteredModels).toHaveLength(2);
      expect(result.current.filteredModels.map((m) => m.name)).toEqual([
        'Coldcard Mk4',
        'Coldcard Q',
      ]);
    });

    it('should show all models when manufacturer is null', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // First set a manufacturer
      act(() => {
        result.current.setSelectedManufacturer('Ledger');
      });

      expect(result.current.filteredModels).toHaveLength(1);

      // Then clear it
      act(() => {
        result.current.setSelectedManufacturer(null);
      });

      expect(result.current.filteredModels).toHaveLength(4);
    });

    it('should update selectedManufacturer state', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSelectedManufacturer('SatoshiLabs');
      });

      expect(result.current.selectedManufacturer).toBe('SatoshiLabs');
    });
  });

  describe('Search Filtering', () => {
    it('should filter models by name search', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSearchQuery('Nano');
      });

      expect(result.current.filteredModels).toHaveLength(1);
      expect(result.current.filteredModels[0].name).toBe('Ledger Nano X');
    });

    it('should filter models by manufacturer search', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSearchQuery('Coinkite');
      });

      expect(result.current.filteredModels).toHaveLength(2);
    });

    it('should be case insensitive', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSearchQuery('TREZOR');
      });

      expect(result.current.filteredModels).toHaveLength(1);
      expect(result.current.filteredModels[0].name).toBe('Trezor Model T');
    });

    it('should handle partial matches', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSearchQuery('cold');
      });

      expect(result.current.filteredModels).toHaveLength(2);
    });

    it('should ignore whitespace-only search', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSearchQuery('   ');
      });

      expect(result.current.filteredModels).toHaveLength(4);
    });

    it('should update searchQuery state', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSearchQuery('test query');
      });

      expect(result.current.searchQuery).toBe('test query');
    });
  });

  describe('Combined Filtering', () => {
    it('should apply both manufacturer and search filters', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSelectedManufacturer('Coinkite');
        result.current.setSearchQuery('Q');
      });

      expect(result.current.filteredModels).toHaveLength(1);
      expect(result.current.filteredModels[0].name).toBe('Coldcard Q');
    });

    it('should return empty array when no matches', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setSearchQuery('nonexistent');
      });

      expect(result.current.filteredModels).toHaveLength(0);
    });
  });

  describe('clearFilters', () => {
    it('should clear both manufacturer and search filters', async () => {
      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set some filters
      act(() => {
        result.current.setSelectedManufacturer('Ledger');
        result.current.setSearchQuery('Nano');
      });

      expect(result.current.filteredModels).toHaveLength(1);

      // Clear all filters
      act(() => {
        result.current.clearFilters();
      });

      expect(result.current.selectedManufacturer).toBeNull();
      expect(result.current.searchQuery).toBe('');
      expect(result.current.filteredModels).toHaveLength(4);
    });
  });

  describe('Multiple Instances', () => {
    it('should work independently with multiple instances', async () => {
      const { result: result1 } = renderHook(() => useDeviceModels());
      const { result: result2 } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result1.current.loading).toBe(false);
        expect(result2.current.loading).toBe(false);
      });

      act(() => {
        result1.current.setSelectedManufacturer('Ledger');
      });

      expect(result1.current.filteredModels).toHaveLength(1);
      expect(result2.current.filteredModels).toHaveLength(4);
    });
  });

  describe('Empty Response', () => {
    it('should handle empty models array', async () => {
      mockGetDeviceModels.mockResolvedValue([]);

      const { result } = renderHook(() => useDeviceModels());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.deviceModels).toEqual([]);
      expect(result.current.manufacturers).toEqual([]);
      expect(result.current.filteredModels).toEqual([]);
    });
  });
});
