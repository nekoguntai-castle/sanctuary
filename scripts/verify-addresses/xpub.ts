import bs58check from 'bs58check';
import type { AccountKeyEvidence, DerivationFamily, Slip132Format } from './types.js';

const VERSION_HEX: Record<Slip132Format, string> = {
  xpub: '0488b21e', ypub: '049d7cb2', zpub: '04b24746', Ypub: '0295b43f', Zpub: '02aa7ed3',
  tpub: '043587cf', upub: '044a5262', vpub: '045f1cf6', Upub: '024289ef', Vpub: '02575483',
};

const FORMAT_BY_VERSION = new Map(
  Object.entries(VERSION_HEX).map(([format, version]) => [version, format as Slip132Format]),
);

export function canonicalFormatForFamily(family: DerivationFamily): 'xpub' | 'tpub' {
  return family === 'mainnet' ? 'xpub' : 'tpub';
}

export function formatFamily(format: Slip132Format): DerivationFamily {
  return ['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub'].includes(format) ? 'mainnet' : 'testnet';
}

function decodePayload(extendedKey: string): Buffer {
  let payload: Buffer;
  try {
    payload = Buffer.from(bs58check.decode(extendedKey));
  } catch {
    throw new Error('Invalid extended public key checksum or encoding');
  }
  if (payload.length !== 78) throw new Error('Invalid extended public key payload length');
  if (payload[45] !== 0x02 && payload[45] !== 0x03) {
    throw new Error('Extended key is not a compressed public key');
  }
  if (!FORMAT_BY_VERSION.has(payload.subarray(0, 4).toString('hex'))) {
    throw new Error('Unsupported extended public key version');
  }
  return payload;
}

export function convertExtendedPublicKey(
  extendedKey: string,
  targetFormat: Slip132Format,
  expectedSourceFamily?: DerivationFamily,
): string {
  const payload = decodePayload(extendedKey);
  const sourceFormat = FORMAT_BY_VERSION.get(payload.subarray(0, 4).toString('hex'))!;
  if (expectedSourceFamily && formatFamily(sourceFormat) !== expectedSourceFamily) {
    throw new Error('Extended public key network family mismatch');
  }
  if (formatFamily(targetFormat) !== formatFamily(sourceFormat)) {
    throw new Error('Cannot convert an extended public key across network families');
  }
  return bs58check.encode(Buffer.concat([
    Buffer.from(VERSION_HEX[targetFormat], 'hex'),
    payload.subarray(4),
  ]));
}

export function decodeAccountKeyEvidence(options: {
  seedId: string;
  masterFingerprint: string;
  originPath: string;
  encoded: string;
  expectedFormat: Slip132Format;
}): AccountKeyEvidence {
  const payload = decodePayload(options.encoded);
  const versionHex = payload.subarray(0, 4).toString('hex');
  if (versionHex !== VERSION_HEX[options.expectedFormat]) {
    throw new Error(`Extended public key version mismatch for ${options.expectedFormat}`);
  }
  return {
    seedId: options.seedId,
    masterFingerprint: options.masterFingerprint.toLowerCase(),
    originPath: options.originPath,
    encoded: options.encoded,
    versionHex,
    depth: payload[4],
    parentFingerprint: payload.subarray(5, 9).toString('hex'),
    childNumber: payload.readUInt32BE(9),
    chainCodeHex: payload.subarray(13, 45).toString('hex'),
    publicKeyHex: payload.subarray(45, 78).toString('hex'),
    payloadHex: payload.subarray(4).toString('hex'),
  };
}

export const slip132VersionHex = (format: Slip132Format): string => VERSION_HEX[format];
