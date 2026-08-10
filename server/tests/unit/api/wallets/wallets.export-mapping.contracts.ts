import { describe, expect, it } from 'vitest';
import {
  mapDeviceToSparrowWalletModel,
  mapDeviceTypeToSparrowWalletModel,
} from '../../../../src/services/export/sparrowWalletModel';

export const registerWalletExportMappingContracts = () => {
  // ==================== Sparrow wallet model mapping tests ====================

  describe('Sparrow wallet model mapping', () => {
    it('should map coldcard types correctly', () => {
      expect(mapDeviceTypeToSparrowWalletModel('coldcard')).toBe('COLDCARD');
      expect(mapDeviceTypeToSparrowWalletModel('coldcard_q')).toBe('COLDCARD');
      expect(mapDeviceTypeToSparrowWalletModel('coldcard_mk4')).toBe('COLDCARD');
    });

    it('should map ledger types correctly', () => {
      expect(mapDeviceTypeToSparrowWalletModel('ledger')).toBe('LEDGER_NANO_S');
      expect(mapDeviceTypeToSparrowWalletModel('ledger_nano_x')).toBe('LEDGER_NANO_X');
      expect(mapDeviceTypeToSparrowWalletModel('ledger_nano_s_plus')).toBe('LEDGER_NANO_S_PLUS');
      expect(mapDeviceTypeToSparrowWalletModel('ledger_gen_5')).toBe('LEDGER_NANO_GEN5');
      expect(mapDeviceTypeToSparrowWalletModel('ledger-gen-5')).toBe('LEDGER_NANO_GEN5');
      expect(mapDeviceTypeToSparrowWalletModel('Ledger Gen 5')).toBe('LEDGER_NANO_GEN5');
    });

    it('should prefer exact catalog metadata over broad device type', () => {
      expect(mapDeviceToSparrowWalletModel({
        type: 'Ledger',
        modelSlug: 'ledger-gen-5',
        modelName: 'Ledger Gen 5',
      })).toBe('LEDGER_NANO_GEN5');
    });

    it('should map trezor types correctly', () => {
      expect(mapDeviceTypeToSparrowWalletModel('trezor')).toBe('TREZOR_1');
      expect(mapDeviceTypeToSparrowWalletModel('trezor_safe_3')).toBe('TREZOR_SAFE_3');
    });

    it('should use the existing Sparrow export fallback for unknown types', () => {
      expect(mapDeviceTypeToSparrowWalletModel('unknown_device')).toBe('COLDCARD');
      expect(mapDeviceTypeToSparrowWalletModel('Custom Hardware')).toBe('COLDCARD');
    });
  });
};
