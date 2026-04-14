import { describe, expect, it } from 'vitest';
import {
  parseDescriptorForImport,
} from './descriptorParserTestHarness';

export function registerDescriptorParserMultiSigContracts(): void {
  describe('parseDescriptorForImport - Multi-sig Descriptors', () => {
    describe('wsh(sortedmulti)', () => {
      it('should parse 2-of-3 wsh(sortedmulti) descriptor', () => {
        const descriptor = 'wsh(sortedmulti(2,[aabbccdd/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/0/*,[11223344/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/0/*,[99887766/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheS/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(3);
        expect(result.devices).toHaveLength(3);
        expect(result.devices[0].fingerprint).toBe('aabbccdd');
        expect(result.devices[1].fingerprint).toBe('11223344');
        expect(result.devices[2].fingerprint).toBe('99887766');
        expect(result.devices[0].derivationPath).toBe("m/48'/1'/0'/2'");
      });

      it('should parse 3-of-5 wsh(sortedmulti) descriptor', () => {
        // Use proper 8-character hex fingerprints and valid xpubs
        const descriptor = 'wsh(sortedmulti(3,[aabbccdd/48h/0h/0h/2h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*,[11223344/48h/0h/0h/2h]xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5/0/*,[99887766/48h/0h/0h/2h]xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj/0/*,[deadbeef/48h/0h/0h/2h]xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ/0/*,[cafebabe/48h/0h/0h/2h]xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.quorum).toBe(3);
        expect(result.totalSigners).toBe(5);
        expect(result.devices).toHaveLength(5);
      });

      it('should parse wsh(multi) descriptor (non-sorted)', () => {
        const descriptor = 'wsh(multi(2,[aabbccdd/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/0/*,[11223344/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.scriptType).toBe('native_segwit');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(2);
      });
    });

    describe('sh(wsh(sortedmulti)) - Nested SegWit Multisig', () => {
      it('should parse sh(wsh(sortedmulti)) descriptor', () => {
        const descriptor = 'sh(wsh(sortedmulti(2,[aabbccdd/48h/1h/0h/1h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/0/*,[11223344/48h/1h/0h/1h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/0/*)))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.scriptType).toBe('nested_segwit');
        expect(result.quorum).toBe(2);
        expect(result.totalSigners).toBe(2);
        expect(result.devices[0].derivationPath).toBe("m/48'/1'/0'/1'");
      });
    });

    describe('sh(sortedmulti) - Legacy Multisig', () => {
      it('should parse sh(sortedmulti) descriptor', () => {
        const descriptor = 'sh(sortedmulti(2,[aabbccdd/45h/0h]xpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/0/*,[11223344/45h/0h]xpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/0/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.type).toBe('multi_sig');
        expect(result.scriptType).toBe('legacy');
        expect(result.quorum).toBe(2);
      });
    });

    describe('Change chain detection', () => {
      it('should detect change chain in multisig descriptor', () => {
        const descriptor = 'wsh(sortedmulti(2,[aabbccdd/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/1/*,[11223344/48h/1h/0h/2h]tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheR/1/*))';

        const result = parseDescriptorForImport(descriptor);

        expect(result.isChange).toBe(true);
      });
    });
  });
}
