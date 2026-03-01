/**
 * Wallet Import - Descriptor Import
 *
 * Handles importing wallets from output descriptor strings and
 * pre-parsed data (BlueWallet text, Coldcard JSON, etc.).
 */

import type { ParsedDescriptor, Network } from '../bitcoin/descriptorParser';
import { parseImportInput } from '../import';
import { resolveDevices, checkDuplicateWallet } from './deviceResolution';
import { createWalletTransaction } from './walletImportService';
import type { ImportWalletResult } from './types';

/**
 * Import wallet from descriptor string
 */
export async function importFromDescriptor(
  userId: string,
  input: {
    descriptor: string;
    name: string;
    network?: Network;
    deviceLabels?: Record<string, string>; // fingerprint -> label
  }
): Promise<ImportWalletResult> {
  // Parse descriptor (use parseImportInput to handle text with comments)
  const parseResult = parseImportInput(input.descriptor);
  const parsed = parseResult.parsed;
  const network = input.network || parsed.network;

  // Check for duplicate wallet
  const newFingerprints = new Set(parsed.devices.map(d => d.fingerprint.toLowerCase()));
  await checkDuplicateWallet(userId, newFingerprints);

  // Resolve devices
  const resolutions = await resolveDevices(userId, parsed.devices);

  // Create devices and wallet in a transaction
  return createWalletTransaction(userId, {
    parsed,
    resolutions,
    name: input.name,
    network,
    deviceLabels: input.deviceLabels,
  });
}

/**
 * Import wallet from pre-parsed data (e.g., BlueWallet text format)
 */
export async function importFromParsedData(
  userId: string,
  input: {
    parsed: ParsedDescriptor;
    name: string;
    network?: Network;
    deviceLabels?: Record<string, string>; // fingerprint -> label
  }
): Promise<ImportWalletResult> {
  const { parsed } = input;
  const network = input.network || parsed.network;

  // Check for duplicate wallet
  const newFingerprints = new Set(parsed.devices.map(d => d.fingerprint.toLowerCase()));
  await checkDuplicateWallet(userId, newFingerprints);

  // Resolve devices
  const resolutions = await resolveDevices(userId, parsed.devices);

  // Create devices and wallet in a transaction
  return createWalletTransaction(userId, {
    parsed,
    resolutions,
    name: input.name,
    network,
    deviceLabels: input.deviceLabels,
  });
}
