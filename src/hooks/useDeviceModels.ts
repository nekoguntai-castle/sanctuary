/**
 * Device Models Hook
 *
 * Manages state for hardware device model selection including:
 * - Fetching available device models from API
 * - Manufacturer filtering
 * - Search filtering
 * - Computed filtered models list
 */

import { useState, useEffect, useMemo } from 'react';
import { getDeviceModels, HardwareDeviceModel } from '../api/devices';
import { createLogger } from '../utils/logger';

const log = createLogger('useDeviceModels');

export interface UseDeviceModelsState {
  /** All device models from API */
  deviceModels: HardwareDeviceModel[];
  /** Unique manufacturers extracted from models */
  manufacturers: string[];
  /** Whether models are loading */
  loading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Currently selected manufacturer filter */
  selectedManufacturer: string | null;
  /** Current search query */
  searchQuery: string;
  /** Models filtered by manufacturer and search query */
  filteredModels: HardwareDeviceModel[];
  /** Set manufacturer filter (null for all) */
  setSelectedManufacturer: (manufacturer: string | null) => void;
  /** Set search query */
  setSearchQuery: (query: string) => void;
  /** Clear all filters */
  clearFilters: () => void;
}

/**
 * Hook for managing device model selection state
 *
 * @example
 * const {
 *   filteredModels,
 *   loading,
 *   manufacturers,
 *   selectedManufacturer,
 *   setSelectedManufacturer,
 *   searchQuery,
 *   setSearchQuery,
 * } = useDeviceModels();
 */
export function useDeviceModels(): UseDeviceModelsState {
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch device models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const models = await getDeviceModels();
        setDeviceModels(models);

        // Extract unique manufacturers
        const uniqueManufacturers = [...new Set(models.map(m => m.manufacturer))].sort();
        setManufacturers(uniqueManufacturers);
      } catch (err) {
        log.error('Failed to fetch device models', { error: err });
        setError('Failed to load device models. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    fetchModels();
  }, []);

  // Filter models by manufacturer and search query
  const filteredModels = useMemo(() => {
    let models = deviceModels;

    // Filter by manufacturer
    if (selectedManufacturer) {
      models = models.filter(m => m.manufacturer === selectedManufacturer);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      models = models.filter(m =>
        m.name.toLowerCase().includes(query) ||
        m.manufacturer.toLowerCase().includes(query)
      );
    }

    return models;
  }, [deviceModels, selectedManufacturer, searchQuery]);

  const clearFilters = () => {
    setSelectedManufacturer(null);
    setSearchQuery('');
  };

  return {
    deviceModels,
    manufacturers,
    loading,
    error,
    selectedManufacturer,
    searchQuery,
    filteredModels,
    setSelectedManufacturer,
    setSearchQuery,
    clearFilters,
  };
}
