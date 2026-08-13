import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  ADDRESS_KEY_CORPUS_PROVENANCE,
  ADDRESS_KEY_CORPUS_EVIDENCE_TIER,
  BIP173_HISTORICAL_VALID_ADDRESSES,
  BIP173_INVALID_ADDRESSES,
  BIP173_SUPERSEDED_VALID_ADDRESSES,
  BIP173_VALID_ADDRESSES,
  BIP350_INVALID_ADDRESSES,
  BIP350_VALID_ADDRESSES,
  INVALID_BECH32M_STRINGS,
  INVALID_BECH32_STRINGS,
  KEY_IO_INVALID_VECTORS,
  KEY_IO_PUBLIC_ADDRESSES,
  KEY_IO_VALID_WAIVERS,
  VALID_BECH32M_STRINGS,
  VALID_BECH32_STRINGS,
} from '../../server/tests/fixtures/generated/address-key-corpora';
import { BIP32_INVALID_SERIALIZATION_VECTORS } from '../../server/tests/fixtures/bip32-test-vectors';

interface SourceManifestEntry {
  path: string;
  sha256: string;
  commit: string;
  url: string;
  expectedInvalidSerializations?: number;
}

const manifest = JSON.parse(
  readFileSync('config/address-key-corpus-sources.json', 'utf8'),
) as { evidenceTier: string; sources: Record<string, SourceManifestEntry> };

describe('generated primary-source address and key corpora', () => {
  it('locks every vendored byte to a commit-qualified URL and SHA-256', () => {
    expect(manifest.evidenceTier).toBe('literal-official-vector');
    expect(ADDRESS_KEY_CORPUS_EVIDENCE_TIER).toBe('literal-official-vector');
    expect(Object.keys(manifest.sources)).toEqual([
      'bitcoinCoreKeyIoValid',
      'bitcoinCoreKeyIoInvalid',
      'bip32',
      'bip173',
      'bip350',
    ]);

    for (const [sourceId, source] of Object.entries(manifest.sources)) {
      const content = readFileSync(source.path);
      expect(createHash('sha256').update(content).digest('hex'), sourceId).toBe(source.sha256);
      expect(source.commit, sourceId).toMatch(/^[0-9a-f]{40}$/);
      expect(source.url, sourceId).toContain(source.commit);
      expect(ADDRESS_KEY_CORPUS_PROVENANCE[sourceId as keyof typeof ADDRESS_KEY_CORPUS_PROVENANCE])
        .toEqual({
          commit: source.commit,
          url: source.url,
          sha256: source.sha256,
          evidenceTier: 'literal-official-vector',
        });
    }
    expect(manifest.sources.bip32.expectedInvalidSerializations).toBe(16);
    expect(BIP32_INVALID_SERIALIZATION_VECTORS).toHaveLength(16);
  });

  it('disposes every Bitcoin Core key_io row exactly once', () => {
    expect(KEY_IO_PUBLIC_ADDRESSES).toHaveLength(54);
    expect(KEY_IO_VALID_WAIVERS).toHaveLength(16);
    expect(KEY_IO_INVALID_VECTORS).toHaveLength(70);

    const validRows = [
      ...KEY_IO_PUBLIC_ADDRESSES.map((vector) => vector.upstreamRow),
      ...KEY_IO_VALID_WAIVERS.map((waiver) => waiver.upstreamRow),
    ].sort((left, right) => left - right);
    expect(validRows).toEqual(Array.from({ length: 70 }, (_, index) => index));
    expect(KEY_IO_INVALID_VECTORS.map((vector) => vector.upstreamRow))
      .toEqual(Array.from({ length: 70 }, (_, index) => index));
    expect(KEY_IO_PUBLIC_ADDRESSES.reduce<Record<string, number>>((counts, vector) => {
      counts[vector.chain] = (counts[vector.chain] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ main: 14, test: 14, signet: 14, regtest: 12 });
    expect(new Set(KEY_IO_VALID_WAIVERS.map((waiver) => waiver.reason))).toEqual(new Set([
      'Private-key encoding is outside Sanctuary recipient-address validation',
    ]));
    expect(new Set([
      ...KEY_IO_PUBLIC_ADDRESSES,
      ...KEY_IO_VALID_WAIVERS,
      ...KEY_IO_INVALID_VECTORS,
    ].map((vector) => vector.evidenceTier))).toEqual(new Set(['literal-official-vector']));
  });

  it('projects the complete BIP173 and BIP350 source sections', () => {
    expect(VALID_BECH32_STRINGS).toHaveLength(7);
    expect(INVALID_BECH32_STRINGS).toHaveLength(12);
    expect(BIP173_HISTORICAL_VALID_ADDRESSES).toHaveLength(6);
    expect(BIP173_VALID_ADDRESSES).toHaveLength(3);
    expect(BIP173_SUPERSEDED_VALID_ADDRESSES).toHaveLength(3);
    expect(BIP173_INVALID_ADDRESSES).toHaveLength(10);
    expect(VALID_BECH32M_STRINGS).toHaveLength(7);
    expect(INVALID_BECH32M_STRINGS).toHaveLength(14);
    expect(BIP350_VALID_ADDRESSES).toHaveLength(8);
    expect(BIP350_INVALID_ADDRESSES).toHaveLength(15);
    expect(new Set(BIP173_SUPERSEDED_VALID_ADDRESSES.map((vector) => vector.waiver)))
      .toEqual(new Set([
        'BIP350 superseded Bech32 encoding for witness versions 1 through 16',
      ]));
    expect(new Set([
      ...INVALID_BECH32_STRINGS,
      ...BIP173_HISTORICAL_VALID_ADDRESSES,
      ...BIP173_SUPERSEDED_VALID_ADDRESSES,
      ...BIP173_INVALID_ADDRESSES,
      ...INVALID_BECH32M_STRINGS,
      ...BIP350_VALID_ADDRESSES,
      ...BIP350_INVALID_ADDRESSES,
    ].map((vector) => vector.evidenceTier))).toEqual(new Set(['literal-official-vector']));
  });

  it('regenerates deterministically with no checked-in diff', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/generate-address-key-corpora.mjs', '--check'],
      { encoding: 'utf8' },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('projection is current');
  });
});
