/**
 * BBQr Decoder
 *
 * Decodes Coldcard's BBQr format - a multi-part QR encoding for larger files.
 * Specification: https://github.com/coinkite/BBQr
 *
 * Header format (8 characters):
 * - B$ (2 chars): Fixed protocol identifier
 * - Encoding (1 char): H=Hex, 2=Base32, Z=Zlib+Base32
 * - FileType (1 char): P=PSBT, T=TXN, J=JSON, C=CBOR, U=Unicode, B=Binary, X=Executable
 * - TotalParts (2 chars): Base36 encoded total number of QR codes
 * - PartIndex (2 chars): Base36 encoded index of this part (0-based)
 */

import { createLogger } from '../utils/logger';

const log = createLogger('BBQr');

// File type codes
export type BBQrFileType = 'P' | 'T' | 'J' | 'C' | 'U' | 'B' | 'X';

export const BBQrFileTypes: Record<BBQrFileType, string> = {
  P: 'PSBT',
  T: 'Transaction',
  J: 'JSON',
  C: 'CBOR',
  U: 'Unicode Text',
  B: 'Binary',
  X: 'Executable',
};

// Encoding type codes
export type BBQrEncoding = 'H' | '2' | 'Z';

export const BBQrEncodings: Record<BBQrEncoding, string> = {
  H: 'Hex',
  '2': 'Base32',
  Z: 'Zlib+Base32',
};

export interface BBQrHeader {
  encoding: BBQrEncoding;
  fileType: BBQrFileType;
  totalParts: number;
  partIndex: number;
}

export interface BBQrDecodeResult {
  data: Uint8Array;
  fileType: BBQrFileType;
  text?: string; // For JSON/Unicode file types
}

/**
 * Check if content is BBQr format
 */
export function isBBQr(content: string): boolean {
  return content.startsWith('B$') && content.length >= 8;
}

/**
 * Parse Base36 string to number
 */
function parseBase36(str: string): number {
  return parseInt(str, 36);
}

/**
 * Parse BBQr header from QR content
 */
export function parseBBQrHeader(content: string): BBQrHeader | null {
  if (!isBBQr(content) || content.length < 8) {
    return null;
  }

  const encoding = content[2] as BBQrEncoding;
  const fileType = content[3] as BBQrFileType;
  const totalParts = parseBase36(content.substring(4, 6));
  const partIndex = parseBase36(content.substring(6, 8));

  // Validate encoding
  if (!['H', '2', 'Z'].includes(encoding)) {
    log.warn('Unknown encoding', { encoding });
    return null;
  }

  // Validate file type
  if (!['P', 'T', 'J', 'C', 'U', 'B', 'X'].includes(fileType)) {
    log.warn('Unknown file type', { fileType });
    return null;
  }

  return { encoding, fileType, totalParts, partIndex };
}

/**
 * Extract data portion from BBQr QR content (after 8-char header)
 */
export function extractBBQrData(content: string): string {
  return content.substring(8);
}

/**
 * RFC 4648 Base32 alphabet (no padding)
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode Base32 string to bytes (RFC 4648, no padding)
 */
export function decodeBase32(input: string): Uint8Array {
  // Build lookup table
  const lookup: Record<string, number> = {};
  for (let i = 0; i < BASE32_ALPHABET.length; i++) {
    lookup[BASE32_ALPHABET[i]] = i;
  }

  // Remove any padding (shouldn't be there per BBQr spec)
  const data = input.replace(/=+$/, '').toUpperCase();

  // Each Base32 char = 5 bits, output = 8 bits per byte
  // 8 chars = 40 bits = 5 bytes
  const outputLength = Math.floor((data.length * 5) / 8);
  const output = new Uint8Array(outputLength);

  let bits = 0;
  let value = 0;
  let index = 0;

  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    const charValue = lookup[char];

    if (charValue === undefined) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    value = (value << 5) | charValue;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output[index++] = (value >> bits) & 0xff;
    }
  }

  return output;
}

/**
 * Decode hex string to bytes
 */
export function decodeHex(input: string): Uint8Array {
  const hex = input.toUpperCase();
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }

  const output = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    if (isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i}`);
    }
    output[i / 2] = byte;
  }

  return output;
}

/**
 * BBQr Decoder class - accumulates parts and decodes when complete
 */
export class BBQrDecoder {
  private parts: Map<number, string> = new Map();
  private _totalParts: number = 0;
  private _encoding: BBQrEncoding | null = null;
  private _fileType: BBQrFileType | null = null;
  private _error: string | null = null;

  /**
   * Reset decoder state
   */
  reset(): void {
    this.parts.clear();
    this._totalParts = 0;
    this._encoding = null;
    this._fileType = null;
    this._error = null;
  }

  /**
   * Receive a BBQr part
   * Returns true if part was accepted, false if error
   */
  receivePart(content: string): boolean {
    const header = parseBBQrHeader(content);
    if (!header) {
      this._error = 'Invalid BBQr header';
      return false;
    }

    // First part initializes decoder state
    if (this._totalParts === 0) {
      this._totalParts = header.totalParts;
      this._encoding = header.encoding;
      this._fileType = header.fileType;
    } else {
      // Validate subsequent parts match
      if (header.totalParts !== this._totalParts) {
        this._error = `Part count mismatch: expected ${this._totalParts}, got ${header.totalParts}`;
        return false;
      }
      if (header.encoding !== this._encoding) {
        this._error = `Encoding mismatch: expected ${this._encoding}, got ${header.encoding}`;
        return false;
      }
      if (header.fileType !== this._fileType) {
        this._error = `File type mismatch: expected ${this._fileType}, got ${header.fileType}`;
        return false;
      }
    }

    // Store the data portion
    const data = extractBBQrData(content);
    this.parts.set(header.partIndex, data);

    return true;
  }

  /**
   * Check if all parts have been received
   */
  isComplete(): boolean {
    if (this._totalParts === 0) return false;
    return this.parts.size === this._totalParts;
  }

  /**
   * Get progress as percentage (0-100)
   */
  getProgress(): number {
    if (this._totalParts === 0) return 0;
    return Math.round((this.parts.size / this._totalParts) * 100);
  }

  /**
   * Get number of received parts
   */
  getReceivedCount(): number {
    return this.parts.size;
  }

  /**
   * Get total expected parts
   */
  getTotalParts(): number {
    return this._totalParts;
  }

  /**
   * Get file type
   */
  getFileType(): BBQrFileType | null {
    return this._fileType;
  }

  /**
   * Get encoding
   */
  getEncoding(): BBQrEncoding | null {
    return this._encoding;
  }

  /**
   * Get error message if any
   */
  getError(): string | null {
    return this._error;
  }

  /**
   * Check which parts are missing
   */
  getMissingParts(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this._totalParts; i++) {
      if (!this.parts.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  /**
   * Decode the complete data
   * Call only after isComplete() returns true
   */
  decode(): BBQrDecodeResult {
    if (!this.isComplete()) {
      throw new Error('Cannot decode: not all parts received');
    }

    // Concatenate all parts in order
    let combinedData = '';
    for (let i = 0; i < this._totalParts; i++) {
      const part = this.parts.get(i);
      if (!part) {
        throw new Error(`Missing part ${i}`);
      }
      combinedData += part;
    }

    // Decode based on encoding type
    let bytes: Uint8Array;

    switch (this._encoding) {
      case 'H':
        bytes = decodeHex(combinedData);
        break;
      case '2':
        bytes = decodeBase32(combinedData);
        break;
      case 'Z':
        // Zlib compressed, then Base32 encoded
        // Note: Zlib decompression requires pako library which is not currently installed
        // Coldcard Q typically uses Base32 encoding ('2') for JSON exports, not Zlib
        throw new Error(
          'Zlib-compressed BBQr (encoding "Z") is not currently supported. ' +
          'Please export using Base32 encoding from your Coldcard.'
        );
      default:
        throw new Error(`Unknown encoding: ${this._encoding}`);
    }

    const result: BBQrDecodeResult = {
      data: bytes,
      fileType: this._fileType!,
    };

    // For text-based types, decode as UTF-8
    if (this._fileType === 'J' || this._fileType === 'U') {
      const decoder = new TextDecoder('utf-8');
      result.text = decoder.decode(bytes);
    }

    return result;
  }
}
