/**
 * Shared types for {@link ExportModal} and its extracted tab components.
 */

export type ExportTab = 'qr' | 'json' | 'text' | 'labels' | 'device';
export type QrFormat = 'passport' | 'descriptor';

export interface ExportDevice {
  fingerprint: string;
  derivationPath?: string;
  xpub?: string;
}

// Canonical API contract — re-exported so the modal and its tabs share the
// single source of truth from the wallets API client.
export type { ExportFormat } from '../../../../src/api/wallets';
