#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = resolve(REPOSITORY_ROOT, 'config/address-key-corpus-sources.json');
const DEFAULT_OUTPUT = resolve(
  REPOSITORY_ROOT,
  'server/tests/fixtures/generated/address-key-corpora.ts',
);

const readUtf8 = (path) => readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8');
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const assertCount = (label, actual, expected) => {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, found ${actual}`);
};

function loadSource(source) {
  const content = readUtf8(source.path);
  const actualDigest = sha256(content);
  if (actualDigest !== source.sha256) {
    throw new Error(`${source.path}: SHA-256 ${actualDigest} does not match ${source.sha256}`);
  }
  return content;
}

function sectionBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Unable to locate source section ${start}`);
  return source.slice(startIndex + start.length, endIndex);
}

const bulletLines = (section) => section.split(/\r?\n/).filter((line) => line.startsWith('* '));
const taggedValues = (line) => [...line.matchAll(/<tt>(.*?)<\/tt>/g)].map((match) => match[1]);
const reasonAfterTags = (line) => line.replace(/^.*<\/tt>\s*(?:\+\s*0xFF)?\s*:\s*/, '').trim();

function parseValidStrings(section) {
  return bulletLines(section).map((line) => {
    const [value] = taggedValues(line);
    if (value === undefined) throw new Error(`Missing tagged value in ${line}`);
    return value;
  });
}

function parseInvalidStrings(section) {
  return bulletLines(section).map((line) => {
    const [tagged] = taggedValues(line);
    if (tagged === undefined) throw new Error(`Missing invalid tagged value in ${line}`);
    const prefix = line.match(/^\* 0x([0-9A-F]{2}) \+/i);
    const suffix = /<\/tt>\s*\+\s*0xFF/.test(line) ? String.fromCharCode(0xff) : '';
    return {
      str: `${prefix ? String.fromCharCode(Number.parseInt(prefix[1], 16)) : ''}${tagged}${suffix}`,
      reason: reasonAfterTags(line),
    };
  });
}

function parseValidAddresses(section) {
  return bulletLines(section).map((line) => {
    const [address, scriptPubKeyHex] = taggedValues(line);
    if (address === undefined || scriptPubKeyHex === undefined) {
      throw new Error(`Missing address projection values in ${line}`);
    }
    return { address, scriptPubKeyHex };
  });
}

function parseInvalidAddresses(section) {
  return bulletLines(section).map((line) => {
    const [address] = taggedValues(line);
    if (address === undefined) throw new Error(`Missing invalid address in ${line}`);
    return { address, reason: reasonAfterTags(line) };
  });
}

function parseBip173(content) {
  const validStrings = parseValidStrings(sectionBetween(
    content,
    'The following strings are valid Bech32:',
    'The following string are not valid Bech32',
  ));
  const invalidStrings = parseInvalidStrings(sectionBetween(
    content,
    'The following string are not valid Bech32 (with reason for invalidity):',
    'The following list gives valid segwit addresses',
  ));
  const validAddresses = parseValidAddresses(sectionBetween(
    content,
    'The following list gives valid segwit addresses and the scriptPubKey that they\ntranslate to in hex.',
    'The following list gives invalid segwit addresses',
  ));
  const invalidAddresses = parseInvalidAddresses(sectionBetween(
    content,
    'The following list gives invalid segwit addresses and the reason for\ntheir invalidity.',
    '===Checksum design===',
  ));
  const currentValidAddresses = validAddresses.filter(({ scriptPubKeyHex }) => (
    scriptPubKeyHex.startsWith('00')
  ));
  const supersededValidAddresses = validAddresses.filter(({ scriptPubKeyHex }) => (
    !scriptPubKeyHex.startsWith('00')
  )).map((vector) => ({
    ...vector,
    waiver: 'BIP350 superseded Bech32 encoding for witness versions 1 through 16',
  }));
  return {
    validStrings,
    invalidStrings,
    validAddresses,
    currentValidAddresses,
    supersededValidAddresses,
    invalidAddresses,
  };
}

function parseBip350(content) {
  return {
    validStrings: parseValidStrings(sectionBetween(
      content,
      'The following strings are valid Bech32m:',
      'No string can be simultaneously valid Bech32 and Bech32m',
    )),
    invalidStrings: parseInvalidStrings(sectionBetween(
      content,
      'The following string are not valid Bech32m (with reason for invalidity):',
      '===Test vectors for v0-v16 native segregated witness addresses===',
    )),
    validAddresses: parseValidAddresses(sectionBetween(
      content,
      'The following list gives valid segwit addresses and the scriptPubKey that they\ntranslate to in hex.',
      'The following list gives invalid segwit addresses',
    )),
    invalidAddresses: parseInvalidAddresses(sectionBetween(
      content,
      'The following list gives invalid segwit addresses and the reason for\ntheir invalidity.',
      '==Appendix: checksum design & properties==',
    )),
  };
}

function projectCore(validContent, invalidContent, manifest) {
  const validRows = JSON.parse(validContent);
  const invalidRows = JSON.parse(invalidContent);
  assertCount('Bitcoin Core valid rows', validRows.length, manifest.bitcoinCoreKeyIoValid.expectedRows);
  assertCount('Bitcoin Core invalid rows', invalidRows.length, manifest.bitcoinCoreKeyIoInvalid.expectedRows);

  const publicAddresses = [];
  const validWaivers = [];
  validRows.forEach((row, upstreamRow) => {
    const [encoded, expected, metadata] = row;
    if (metadata.isPrivkey) {
      validWaivers.push({
        upstreamRow,
        encoded,
        reason: 'Private-key encoding is outside Sanctuary recipient-address validation',
      });
      return;
    }
    publicAddresses.push({
      upstreamRow,
      address: encoded,
      scriptPubKeyHex: expected,
      chain: metadata.chain,
      ...(metadata.tryCaseFlip ? { tryCaseFlip: true } : {}),
    });
  });
  const invalidAddresses = invalidRows.map(([address], upstreamRow) => ({ upstreamRow, address }));
  assertCount('Bitcoin Core applicable valid rows', publicAddresses.length, manifest.bitcoinCoreKeyIoValid.expectedApplicableRows);
  assertCount('Bitcoin Core valid waivers', validWaivers.length, manifest.bitcoinCoreKeyIoValid.expectedWaivedRows);
  assertCount('Bitcoin Core applicable invalid rows', invalidAddresses.length, manifest.bitcoinCoreKeyIoInvalid.expectedApplicableRows);
  return { publicAddresses, validWaivers, invalidAddresses };
}

function assertBipCounts(bip173, bip350, sources) {
  const expected173 = sources.bip173.expectedCounts;
  assertCount('BIP173 valid strings', bip173.validStrings.length, expected173.validEncodingStrings);
  assertCount('BIP173 invalid strings', bip173.invalidStrings.length, expected173.invalidEncodingStrings);
  assertCount('BIP173 valid addresses', bip173.validAddresses.length, expected173.validAddresses);
  assertCount('BIP173 invalid addresses', bip173.invalidAddresses.length, expected173.invalidAddresses);
  assertCount('BIP173 superseded valid addresses', bip173.supersededValidAddresses.length, expected173.supersededValidAddresses);
  const expected350 = sources.bip350.expectedCounts;
  assertCount('BIP350 valid strings', bip350.validStrings.length, expected350.validEncodingStrings);
  assertCount('BIP350 invalid strings', bip350.invalidStrings.length, expected350.invalidEncodingStrings);
  assertCount('BIP350 valid addresses', bip350.validAddresses.length, expected350.validAddresses);
  assertCount('BIP350 invalid addresses', bip350.invalidAddresses.length, expected350.invalidAddresses);
}

const literal = (value) => JSON.stringify(value, null, 2);
const tierRows = (rows) => rows.map((row) => ({
  ...row,
  evidenceTier: 'literal-official-vector',
}));

function renderProjection(manifest, core, bip173, bip350) {
  const provenance = Object.fromEntries(Object.entries(manifest.sources).map(([id, source]) => [id, {
    commit: source.commit,
    url: source.url,
    sha256: source.sha256,
    evidenceTier: manifest.evidenceTier,
  }]));
  return `/** GENERATED by scripts/generate-address-key-corpora.mjs. DO NOT EDIT. */

export type AddressKeyCorpusEvidenceTier = 'literal-official-vector';
export const ADDRESS_KEY_CORPUS_EVIDENCE_TIER: AddressKeyCorpusEvidenceTier = 'literal-official-vector';
export type KeyIoChain = 'main' | 'test' | 'signet' | 'regtest';
export interface KeyIoAddressVector {
  readonly upstreamRow: number;
  readonly address: string;
  readonly scriptPubKeyHex: string;
  readonly chain: KeyIoChain;
  readonly tryCaseFlip?: boolean;
  readonly evidenceTier: AddressKeyCorpusEvidenceTier;
}
export interface SegwitAddressVector {
  readonly address: string;
  readonly scriptPubKeyHex: string;
  readonly evidenceTier: AddressKeyCorpusEvidenceTier;
}

export const ADDRESS_KEY_CORPUS_PROVENANCE = ${literal(provenance)} as const;
export const KEY_IO_PUBLIC_ADDRESSES: readonly KeyIoAddressVector[] = ${literal(tierRows(core.publicAddresses))};
export const KEY_IO_MAINNET_ADDRESSES = KEY_IO_PUBLIC_ADDRESSES.filter(vector => vector.chain === 'main');
export const KEY_IO_VALID_WAIVERS = ${literal(tierRows(core.validWaivers))} as const;
export const KEY_IO_INVALID_VECTORS = ${literal(tierRows(core.invalidAddresses))} as const;
export const KEY_IO_INVALID_ADDRESSES = KEY_IO_INVALID_VECTORS.map(vector => vector.address);

export const VALID_BECH32_STRINGS = ${literal(bip173.validStrings)} as const;
export const INVALID_BECH32_STRINGS = ${literal(tierRows(bip173.invalidStrings))} as const;
export const BIP173_HISTORICAL_VALID_ADDRESSES: readonly SegwitAddressVector[] = ${literal(tierRows(bip173.validAddresses))};
export const BIP173_VALID_ADDRESSES: readonly SegwitAddressVector[] = ${literal(tierRows(bip173.currentValidAddresses))};
export const BIP173_SUPERSEDED_VALID_ADDRESSES = ${literal(tierRows(bip173.supersededValidAddresses))} as const;
export const BIP173_INVALID_ADDRESSES = ${literal(tierRows(bip173.invalidAddresses))} as const;

export const VALID_BECH32M_STRINGS = ${literal(bip350.validStrings)} as const;
export const INVALID_BECH32M_STRINGS = ${literal(tierRows(bip350.invalidStrings))} as const;
export const BIP350_VALID_ADDRESSES: readonly SegwitAddressVector[] = ${literal(tierRows(bip350.validAddresses))};
export const BIP350_INVALID_ADDRESSES = ${literal(tierRows(bip350.invalidAddresses))} as const;
`;
}

export function generateAddressKeyCorpora() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.evidenceTier !== 'literal-official-vector') {
    throw new Error('Unsupported address/key corpus manifest');
  }
  const sources = manifest.sources;
  const core = projectCore(
    loadSource(sources.bitcoinCoreKeyIoValid),
    loadSource(sources.bitcoinCoreKeyIoInvalid),
    sources,
  );
  const bip173 = parseBip173(loadSource(sources.bip173));
  const bip350 = parseBip350(loadSource(sources.bip350));
  loadSource(sources.bip32);
  assertBipCounts(bip173, bip350, sources);
  return renderProjection(manifest, core, bip173, bip350);
}

function parseArguments(argv) {
  const outputIndex = argv.indexOf('--output');
  return {
    check: argv.includes('--check'),
    output: outputIndex >= 0 ? resolve(argv[outputIndex + 1]) : DEFAULT_OUTPUT,
  };
}

function main() {
  const { check, output } = parseArguments(process.argv.slice(2));
  const generated = generateAddressKeyCorpora();
  if (check) {
    if (readFileSync(output, 'utf8') !== generated) throw new Error(`Generated corpus drift: ${output}`);
    process.stdout.write('Address/key corpus projection is current.\n');
    return;
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, generated);
  process.stdout.write(`Generated ${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
