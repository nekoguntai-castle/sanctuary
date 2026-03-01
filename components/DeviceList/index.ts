/**
 * DeviceList Component Module
 *
 * Refactored DeviceList component split into:
 * - DeviceList (main orchestrator with state management)
 * - DeviceListHeader (title, filters, view toggle, column config)
 * - DeviceGroupedView (card layout grouped by device type)
 * - EmptyState (no devices connected state)
 * - Types (shared type aliases)
 */

// Main component
export { DeviceList } from './DeviceList';

// Subcomponents
export { DeviceListHeader } from './DeviceListHeader';
export { DeviceGroupedView } from './DeviceGroupedView';
export { EmptyState } from './EmptyState';

// Types
export * from './types';
