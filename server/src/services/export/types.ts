/**
 * Export Format Types
 *
 * Defines interfaces for the pluggable export format system.
 * New export formats can be added by implementing ExportFormatHandler.
 */

import type { ScriptType, Network } from '../bitcoin/descriptorParser';
import type { WalletType } from '@sanctuary/shared/constants/walletIdentity';

export const WALLET_EXPORT_FORMAT_VALUES = ['sparrow', 'descriptor', 'bluewallet', 'coldcard'] as const;

/**
 * Wallet data for export
 */
export interface WalletExportData {
  id: string;
  name: string;
  type: WalletType;
  scriptType: ScriptType;
  network: Network;
  descriptor: string;
  changeDescriptor?: string;
  quorum?: number;
  totalSigners?: number;
  devices: DeviceExportData[];
  createdAt: Date;
}

/**
 * Device data for export
 */
export interface DeviceExportData {
  label: string;
  type: string;
  fingerprint: string;
  xpub: string;
  derivationPath?: string;
  modelSlug?: string;
  modelName?: string;
}

/**
 * Export options
 */
export interface ExportOptions {
  /** Include device details */
  includeDevices?: boolean;
  /** Include change descriptor */
  includeChangeDescriptor?: boolean;
  /** Custom filename (without extension) */
  filename?: string;
  /** Additional metadata to include */
  metadata?: Record<string, unknown>;
}

/**
 * Export result
 */
export interface ExportResult {
  /** The exported content */
  content: string;
  /** MIME type for the content */
  mimeType: string;
  /** Suggested filename with extension */
  filename: string;
  /** Character encoding (default: utf-8) */
  encoding?: string;
}

/**
 * Export format handler interface
 *
 * Implement this interface to add support for a new export format.
 * Register the handler with exportFormatRegistry.register()
 */
export interface ExportFormatHandler {
  /** Unique identifier for this format */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Description of what this format is for */
  readonly description: string;

  /** File extension for exports (e.g., '.json', '.txt') */
  readonly fileExtension: string;

  /** MIME type for the export */
  readonly mimeType: string;

  /**
   * Export wallet data in this format
   */
  export(wallet: WalletExportData, options?: ExportOptions): ExportResult;

  /**
   * Check if this format can export the given wallet
   * (e.g., some formats may not support multisig)
   */
  canExport?(wallet: WalletExportData): boolean;
}

/**
 * Registry configuration
 */
export interface ExportFormatRegistryConfig {
  /** Enable debug logging */
  debug?: boolean;
}
