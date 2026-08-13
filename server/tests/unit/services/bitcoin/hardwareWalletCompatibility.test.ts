/**
 * Hardware evidence truthfulness tests.
 *
 * Software-derived vectors are covered separately. They must never be relabeled
 * as physical hardware evidence when the hardware fixture sets are empty.
 */
import { describe, expect, it } from 'vitest';
import {
  HARDWARE_WALLET_CAPABILITY_ROWS,
  HARDWARE_WALLET_CAPABILITIES,
  HARDWARE_WALLET_IMPLEMENTATION_INVENTORY,
  HARDWARE_WALLET_VENDORS,
} from '@sanctuary/shared/constants/hardwareWalletCapabilities';
import {
  HARDWARE_WALLET_MULTISIG_VECTORS,
  HARDWARE_WALLET_SINGLESIG_VECTORS,
} from '@fixtures/hardware-wallet-vectors';
import {
  BLOCKED_HARDWARE_SIGNED_ROWS,
  HARDWARE_SIGNED_PSBT_VECTORS,
} from '@fixtures/hardware-signed-psbt-vectors';

describe('Hardware Wallet Compatibility Evidence', () => {
  it('does not substitute software vectors for missing hardware exports', () => {
    expect(HARDWARE_WALLET_SINGLESIG_VECTORS).toEqual([]);
    expect(HARDWARE_WALLET_MULTISIG_VECTORS).toEqual([]);
    expect(HARDWARE_SIGNED_PSBT_VECTORS).toEqual([]);
  });

  it('keeps every funds-controlling vendor row blocked without physical evidence', () => {
    for (const vendor of HARDWARE_WALLET_VENDORS) {
      const rows = HARDWARE_WALLET_CAPABILITY_ROWS.filter((row) => row.vendor === vendor);
      const inventory = HARDWARE_WALLET_IMPLEMENTATION_INVENTORY.find((row) => row.vendor === vendor);
      expect(inventory).toBeDefined();
      expect(rows).toHaveLength((inventory!.catalogModelSlugs.length + 1) * 6);
      expect(rows.every((row) => !row.enabled)).toBe(true);
      expect(rows.every((row) => row.evidenceTier === 'unverified')).toBe(true);
      expect(rows.every((row) => row.evidenceIds.length === 0)).toBe(true);
      expect(rows.every((row) => row.modelFamily !== '*' && row.modelFamily.length > 0)).toBe(true);
      expect(rows.every((row) => row.firmwareRange === 'unverified')).toBe(true);
      expect(rows.every((row) => row.appVersionRange === 'unverified')).toBe(true);
      expect(rows.every((row) => row.sdkVersionRange === 'unverified')).toBe(true);
      expect(rows.every((row) => row.transport === 'unverified')).toBe(true);
      expect(rows.every((row) => row.derivationNetworkFamily === 'unverified')).toBe(true);
      expect(rows.every((row) => row.chainEnvironment === 'unverified')).toBe(true);
      expect(rows.every((row) => row.policy === 'unverified')).toBe(true);
      expect(rows.every((row) => row.accountRange === 'unverified')).toBe(true);
      expect(rows.every((row) => row.freshness.status === 'unverified')).toBe(true);
      expect(rows.every((row) => row.reason.length > 0)).toBe(true);
    }
  });

  it('does not promote Trezor from emulator proof or evidence-block accounting', () => {
    const blockedTrezorRows = BLOCKED_HARDWARE_SIGNED_ROWS.filter(
      (row) => row.vendor === 'trezor'
    );
    expect(blockedTrezorRows).toHaveLength(5);
    const trezorRows = HARDWARE_WALLET_CAPABILITY_ROWS.filter((row) => row.vendor === 'trezor');
    expect(trezorRows).toHaveLength(36);
    expect(trezorRows.every((row) => !row.enabled && row.evidenceIds.length === 0)).toBe(true);
    expect(trezorRows.every((row) => row.evidenceTier === 'unverified')).toBe(true);
  });

  it('has one unique row for every exact model and capability tuple', () => {
    const ids = HARDWARE_WALLET_CAPABILITY_ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    const expectedIdentities = HARDWARE_WALLET_IMPLEMENTATION_INVENTORY.reduce(
      (count, row) => count + row.catalogModelSlugs.length + 1,
      0
    );
    expect(ids).toHaveLength(expectedIdentities * HARDWARE_WALLET_CAPABILITIES.length);
    expect(Object.isFrozen(HARDWARE_WALLET_CAPABILITY_ROWS)).toBe(true);
    expect(HARDWARE_WALLET_CAPABILITY_ROWS.every((row) => Object.isFrozen(row))).toBe(true);
    expect(HARDWARE_WALLET_CAPABILITY_ROWS.every((row) => Object.isFrozen(row.freshness))).toBe(
      true
    );
  });
});
