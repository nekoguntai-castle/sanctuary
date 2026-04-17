import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockParseBlueWalletText,
  mockParseBlueWalletTextImport,
  mockIsBlueWalletTextFormat,
  mockParseColdcardExport,
  mockParseDescriptorForImport,
  mockIsDescriptorTextFormat,
  mockExtractDescriptorFromText,
  mockParseJsonImport,
  mockColdcardSafeParse,
  mockJsonConfigSafeParse,
  mockJsonImportConfigParse,
  mockWalletExportSafeParse,
} = vi.hoisted(() => ({
  mockParseBlueWalletText: vi.fn(),
  mockParseBlueWalletTextImport: vi.fn(),
  mockIsBlueWalletTextFormat: vi.fn(),
  mockParseColdcardExport: vi.fn(),
  mockParseDescriptorForImport: vi.fn(),
  mockIsDescriptorTextFormat: vi.fn(),
  mockExtractDescriptorFromText: vi.fn(),
  mockParseJsonImport: vi.fn(),
  mockColdcardSafeParse: vi.fn(),
  mockJsonConfigSafeParse: vi.fn(),
  mockJsonImportConfigParse: vi.fn(),
  mockWalletExportSafeParse: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/descriptorParser', () => ({
  parseBlueWalletText: mockParseBlueWalletText,
  parseBlueWalletTextImport: mockParseBlueWalletTextImport,
  isBlueWalletTextFormat: mockIsBlueWalletTextFormat,
  parseColdcardExport: mockParseColdcardExport,
  parseDescriptorForImport: mockParseDescriptorForImport,
  isDescriptorTextFormat: mockIsDescriptorTextFormat,
  extractDescriptorFromText: mockExtractDescriptorFromText,
  parseJsonImport: mockParseJsonImport,
}));

vi.mock('../../../../src/services/import/schemas', () => ({
  ColdcardDetectionSchema: { safeParse: mockColdcardSafeParse },
  JsonConfigDetectionSchema: { safeParse: mockJsonConfigSafeParse },
  JsonImportConfigSchema: { parse: mockJsonImportConfigParse },
  WalletExportDetectionSchema: { safeParse: mockWalletExportSafeParse },
}));

import { bluewalletHandler } from '../../../../src/services/import/handlers/bluewallet';
import { coldcardHandler } from '../../../../src/services/import/handlers/coldcard';
import { descriptorHandler } from '../../../../src/services/import/handlers/descriptor';
import { jsonConfigHandler } from '../../../../src/services/import/handlers/jsonConfig';
import { walletExportHandler } from '../../../../src/services/import/handlers/walletExport';

describe('import format handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('bluewalletHandler', () => {
    it('detects BlueWallet text and computes confidence from markers', () => {
      mockIsBlueWalletTextFormat.mockReturnValueOnce(true);

      const result = bluewalletHandler.canHandle('Name: Test\nPolicy: 2 of 3\nFormat: P2WSH');

      expect(result).toEqual({ detected: true, confidence: 95 });
    });

    it('adjusts confidence when optional BlueWallet markers are missing', () => {
      mockIsBlueWalletTextFormat.mockReturnValueOnce(true);
      expect(bluewalletHandler.canHandle('Name: Only Name')).toEqual({
        detected: true,
        confidence: 80,
      });

      mockIsBlueWalletTextFormat.mockReturnValueOnce(true);
      expect(bluewalletHandler.canHandle('Policy: 2 of 3')).toEqual({
        detected: true,
        confidence: 80,
      });
    });

    it('rejects JSON input and non-matching text', () => {
      expect(bluewalletHandler.canHandle('{"name":"x"}')).toEqual({ detected: false, confidence: 0 });

      mockIsBlueWalletTextFormat.mockReturnValueOnce(false);
      expect(bluewalletHandler.canHandle('random text')).toEqual({ detected: false, confidence: 0 });
    });

    it('parses BlueWallet text and extracts optional name', () => {
      mockParseBlueWalletText.mockReturnValueOnce({ name: 'Blue Wallet' });
      mockParseBlueWalletTextImport.mockReturnValueOnce({ descriptor: 'wsh(...)' });

      const parsed = bluewalletHandler.parse('Name: Blue Wallet');
      expect(parsed).toEqual({
        parsed: { descriptor: 'wsh(...)' },
        suggestedName: 'Blue Wallet',
      });

      mockParseBlueWalletText.mockReturnValueOnce({ name: 'Blue Wallet' });
      expect(bluewalletHandler.extractName('Name: Blue Wallet')).toBe('Blue Wallet');

      mockParseBlueWalletText.mockImplementationOnce(() => {
        throw new Error('bad');
      });
      expect(bluewalletHandler.extractName('bad')).toBeUndefined();
    });
  });

  describe('coldcardHandler', () => {
    it('detects valid Coldcard exports with nested/flat path confidence', () => {
      mockColdcardSafeParse.mockReturnValueOnce({ success: true });
      expect(coldcardHandler.canHandle('{"bip84":{}}')).toEqual({ detected: true, confidence: 95 });

      mockColdcardSafeParse.mockReturnValueOnce({ success: true });
      expect(coldcardHandler.canHandle('{"xfp":"abcd"}')).toEqual({ detected: true, confidence: 85 });
    });

    it('rejects invalid Coldcard input and handles parse errors', () => {
      expect(coldcardHandler.canHandle('not-json')).toEqual({ detected: false, confidence: 0 });

      mockColdcardSafeParse.mockReturnValueOnce({ success: false });
      expect(coldcardHandler.canHandle('{"x":1}')).toEqual({ detected: false, confidence: 0 });

      expect(coldcardHandler.canHandle('{')).toEqual({ detected: false, confidence: 0 });
      expect(() => coldcardHandler.parse('{')).toThrow('Invalid JSON in Coldcard export input');
    });

    it('parses and extracts names with fallback to label', () => {
      mockParseColdcardExport.mockReturnValueOnce({
        parsed: { descriptor: 'wpkh(...)' },
        availablePaths: ['bip84'],
      });

      const parsed = coldcardHandler.parse('{"name":"Coldcard","bip84":{}}');
      expect(parsed).toEqual({
        parsed: { descriptor: 'wpkh(...)' },
        availablePaths: ['bip84'],
        suggestedName: 'Coldcard',
      });

      expect(coldcardHandler.extractName('{"label":"Fallback"}')).toBe('Fallback');
      expect(coldcardHandler.extractName('{')).toBeUndefined();
    });

    it('uses label as parse suggestedName when name is absent', () => {
      mockParseColdcardExport.mockReturnValueOnce({
        parsed: { descriptor: 'wpkh(...)' },
        availablePaths: ['bip84'],
      });

      const parsed = coldcardHandler.parse('{"label":"Coldcard Label","bip84":{}}');
      expect(parsed.suggestedName).toBe('Coldcard Label');
    });
  });

  describe('descriptorHandler', () => {
    it('detects direct descriptors, descriptor text format, comment-prefixed descriptors, and fallback', () => {
      expect(descriptorHandler.canHandle('wpkh([abcd/84h/0h/0h]xpub/0/*)')).toEqual({
        detected: true,
        confidence: 90,
      });

      mockIsDescriptorTextFormat.mockReturnValueOnce(true);
      expect(descriptorHandler.canHandle('Some descriptor text wrapper')).toEqual({
        detected: true,
        confidence: 70,
      });

      mockIsDescriptorTextFormat.mockReturnValueOnce(false);
      expect(descriptorHandler.canHandle('# comment\ntr([abcd/86h/0h/0h]xpub/0/*)')).toEqual({
        detected: true,
        confidence: 60,
      });

      mockIsDescriptorTextFormat.mockReturnValueOnce(false);
      expect(descriptorHandler.canHandle('not a descriptor')).toEqual({ detected: true, confidence: 5 });

      expect(descriptorHandler.canHandle('{"descriptor":"x"}')).toEqual({ detected: false, confidence: 0 });
    });

    it('parses extracted descriptor text when available and falls back otherwise', () => {
      mockIsDescriptorTextFormat.mockReturnValueOnce(true);
      mockExtractDescriptorFromText.mockReturnValueOnce('wsh(sortedmulti(...))');
      mockParseDescriptorForImport.mockReturnValueOnce({ descriptor: 'wsh(sortedmulti(...))' });

      const extracted = descriptorHandler.parse('wrapper');
      expect(extracted).toEqual({ parsed: { descriptor: 'wsh(sortedmulti(...))' } });

      mockIsDescriptorTextFormat.mockReturnValueOnce(true);
      mockExtractDescriptorFromText.mockReturnValueOnce(undefined);
      mockParseDescriptorForImport.mockReturnValueOnce({ descriptor: 'trimmed' });

      const fallback = descriptorHandler.parse(' trimmed ');
      expect(fallback).toEqual({ parsed: { descriptor: 'trimmed' } });
    });

    it('parses plain descriptor text directly when wrapper format is not detected', () => {
      mockIsDescriptorTextFormat.mockReturnValueOnce(false);
      mockParseDescriptorForImport.mockReturnValueOnce({ descriptor: 'direct' });

      const parsed = descriptorHandler.parse(' direct ');
      expect(parsed).toEqual({ parsed: { descriptor: 'direct' } });
    });
  });

  describe('jsonConfigHandler', () => {
    it('detects JSON config with confidence modifiers', () => {
      mockJsonConfigSafeParse.mockReturnValueOnce({ success: true });
      expect(
        jsonConfigHandler.canHandle('{"type":"multi_sig","scriptType":"native_segwit","network":"testnet","quorum":2}')
      ).toEqual({ detected: true, confidence: 90 });

      mockJsonConfigSafeParse.mockReturnValueOnce({ success: true });
      expect(jsonConfigHandler.canHandle('{"devices":[]}')).toEqual({ detected: true, confidence: 50 });
    });

    it('rejects invalid json config input and parse errors', () => {
      expect(jsonConfigHandler.canHandle('not-json')).toEqual({ detected: false, confidence: 0 });

      mockJsonConfigSafeParse.mockReturnValueOnce({ success: false });
      expect(jsonConfigHandler.canHandle('{"x":1}')).toEqual({ detected: false, confidence: 0 });

      expect(jsonConfigHandler.canHandle('{')).toEqual({ detected: false, confidence: 0 });
      expect(() => jsonConfigHandler.parse('{')).toThrow('Invalid JSON in configuration input');
    });

    it('parses, validates, and extracts names', () => {
      const validated = {
        name: 'Config Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        devices: [{ fingerprint: 'abcd1234' }],
      };

      mockJsonImportConfigParse.mockReturnValueOnce(validated);
      mockParseJsonImport.mockReturnValueOnce({ descriptor: 'wpkh(...)', devices: validated.devices, type: 'single_sig' });

      const parsed = jsonConfigHandler.parse('{"name":"Config Wallet"}');
      expect(parsed).toEqual({
        parsed: { descriptor: 'wpkh(...)', devices: validated.devices, type: 'single_sig' },
        originalDevices: validated.devices,
        suggestedName: 'Config Wallet',
      });

      expect(jsonConfigHandler.validate({ devices: [] } as any)).toEqual({
        valid: false,
        errors: ['No devices found in configuration'],
      });
      expect(jsonConfigHandler.validate({ devices: [{}], type: 'multi_sig' } as any)).toEqual({
        valid: false,
        errors: ['Multi-sig wallet requires quorum and totalSigners'],
      });
      expect(jsonConfigHandler.validate({ devices: [{}], type: 'multi_sig', quorum: 2 } as any)).toEqual({
        valid: false,
        errors: ['Multi-sig wallet requires quorum and totalSigners'],
      });
      expect(jsonConfigHandler.validate({ devices: [{}], type: 'single_sig' } as any)).toEqual({ valid: true });

      expect(jsonConfigHandler.extractName('{"name":"Config Wallet"}')).toBe('Config Wallet');
      expect(jsonConfigHandler.extractName('{')).toBeUndefined();
    });
  });

  describe('walletExportHandler', () => {
    it('detects wallet export json with confidence modifiers', () => {
      mockWalletExportSafeParse.mockReturnValueOnce({ success: true });
      expect(walletExportHandler.canHandle('{"descriptor":"wpkh(...)","label":"My Wallet","keystores":[]}')).toEqual({
        detected: true,
        confidence: 95,
      });

      mockWalletExportSafeParse.mockReturnValueOnce({ success: true });
      expect(walletExportHandler.canHandle('{"descriptor":"wpkh(...)"}')).toEqual({
        detected: true,
        confidence: 80,
      });
    });

    it('rejects invalid wallet export input and parse errors', () => {
      expect(walletExportHandler.canHandle('not-json')).toEqual({ detected: false, confidence: 0 });

      mockWalletExportSafeParse.mockReturnValueOnce({ success: false });
      expect(walletExportHandler.canHandle('{"x":1}')).toEqual({ detected: false, confidence: 0 });

      expect(walletExportHandler.canHandle('{')).toEqual({ detected: false, confidence: 0 });
      expect(() => walletExportHandler.parse('{')).toThrow('Invalid JSON in wallet export input');
    });

    it('parses descriptor exports and extracts names', () => {
      mockParseDescriptorForImport.mockReturnValueOnce({ descriptor: 'wpkh(...)' });

      const parsed = walletExportHandler.parse('{"descriptor":"wpkh(...)","label":"Export Name"}');
      expect(parsed).toEqual({
        parsed: { descriptor: 'wpkh(...)' },
        suggestedName: 'Export Name',
      });

      expect(walletExportHandler.extractName('{"name":"ByName"}')).toBe('ByName');
      expect(walletExportHandler.extractName('{')).toBeUndefined();
    });

    it('uses name as parse suggestedName when label is absent', () => {
      mockParseDescriptorForImport.mockReturnValueOnce({ descriptor: 'wpkh(...)' });

      const parsed = walletExportHandler.parse('{"descriptor":"wpkh(...)","name":"ByName"}');
      expect(parsed.suggestedName).toBe('ByName');
    });
  });
});
