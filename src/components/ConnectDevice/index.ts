/**
 * ConnectDevice Component Module
 *
 * Refactored ConnectDevice component split into:
 * - Orchestrator (main component)
 * - UI subcomponents
 * - Hooks for state management
 * - Utility functions
 */

// Main component
export { ConnectDevice } from './ConnectDevice';

// Subcomponents (for advanced use cases)
export { DeviceModelSelector } from './DeviceModelSelector';
export { ConnectionMethodSelector } from './ConnectionMethodSelector';
export { UsbConnectionPanel } from './UsbConnectionPanel';
export { QrScannerPanel } from './QrScannerPanel';
export { FileUploadPanel } from './FileUploadPanel';
export { DeviceDetailsForm } from './DeviceDetailsForm';
export { ConflictDialog } from './ConflictDialog';

// Types
export * from './types';
