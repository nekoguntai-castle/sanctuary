import * as bitcoin from 'bitcoinjs-lib';

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_PREFIXES = ['bcrt1', 'tb1', 'bc1'];

function getBitcoinjsWitnessProgram(address: string): string | null {
  try {
    const decoded = bitcoin.address.fromBech32(address);
    return Buffer.from(decoded.data).toString('hex');
  } catch {
    return null;
  }
}

function isKnownWitnessAddress(address: string): boolean {
  return BECH32_PREFIXES.some((prefix) => address.startsWith(prefix));
}

function getBech32Data(address: string): string | null {
  const separatorIndex = address.lastIndexOf('1');
  if (separatorIndex < 1) {
    return null;
  }

  return address.slice(separatorIndex + 1);
}

function decodeBech32Values(data: string): number[] | null {
  const decoded: number[] = [];

  for (const char of data) {
    const index = BECH32_CHARSET.indexOf(char);
    if (index === -1) {
      return null;
    }
    decoded.push(index);
  }

  return decoded;
}

function convertFiveBitValuesToBytes(values: number[]): number[] {
  const program: number[] = [];
  let acc = 0;
  let bits = 0;

  for (const value of values) {
    // BIP-173 stores witness programs as 5-bit groups; convert them back to bytes.
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      program.push((acc >> bits) & 0xff);
    }
  }

  return program;
}

function getManualWitnessProgram(address: string): string | null {
  // bitcoinjs-lib may not recognize regtest HRP (`bcrt`), so keep a manual fallback.
  const data = getBech32Data(address);
  if (!data) {
    return null;
  }

  const decoded = decodeBech32Values(data);
  if (!decoded) {
    return null;
  }

  const dataWithoutChecksum = decoded.slice(0, -6);
  const programBits = dataWithoutChecksum.slice(1);
  const program = convertFiveBitValuesToBytes(programBits);

  return Buffer.from(program).toString('hex');
}

/**
 * Decode bech32/bech32m address to get the witness program hex.
 */
export function decodeBech32WitnessProgram(address: string): string | null {
  const bitcoinjsProgram = getBitcoinjsWitnessProgram(address);
  if (bitcoinjsProgram) {
    return bitcoinjsProgram;
  }

  const lowerAddress = address.toLowerCase();
  if (!isKnownWitnessAddress(lowerAddress)) {
    return null;
  }

  return getManualWitnessProgram(lowerAddress);
}

/**
 * Normalize an address to its core components for comparison.
 */
export function normalizeAddress(address: string): string {
  if (isKnownWitnessAddress(address)) {
    const witnessProgram = decodeBech32WitnessProgram(address);
    if (witnessProgram) {
      return `wprog:${witnessProgram}`;
    }
  }

  return address;
}
