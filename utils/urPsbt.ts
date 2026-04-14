/**
 * UR-PSBT Utilities
 *
 * Encode and decode PSBTs using Uniform Resources (UR) format
 * for QR code-based signing with air-gapped hardware wallets.
 *
 * SUPPORTED DEVICES:
 * - Foundation Passport (ur:crypto-psbt)
 * - Keystone (ur:crypto-psbt)
 * - SeedSigner (ur:crypto-psbt)
 *
 * UR FORMAT NOTES:
 * - UR (Uniform Resource) is a standard for encoding binary data in QR codes
 * - For PSBTs, the type is "crypto-psbt" which wraps the binary PSBT in CBOR
 * - Large PSBTs use fountain codes to split across multiple animated QR frames
 * - The UREncoder automatically handles splitting; URDecoder handles reassembly
 *
 * CBOR DECODING VARIATIONS:
 * Different hardware wallets return signed PSBTs in slightly different formats:
 * 1. Raw PSBT bytes directly in CBOR - check for 'psbt' magic bytes (0x70737274)
 * 2. CryptoPSBT wrapper object - use CryptoPSBT.fromCBOR() to extract
 * 3. Object with 'data' property containing bytes
 *
 * The getDecodedPsbt() function handles all these cases by:
 * 1. First checking if CBOR data is raw bytes with PSBT magic
 * 2. Falling back to CryptoPSBT.fromCBOR() wrapper
 * 3. Checking for data.data property as last resort
 *
 * TROUBLESHOOTING:
 * If hardware wallet shows "already signed" or rejects PSBT:
 * - Ensure BIP32 derivation info is included in PSBT inputs
 * - Verify fingerprint matches (see transactionService.ts notes on zpub conversion)
 * - Check witnessUtxo/nonWitnessUtxo is present for the script type
 */

import { CryptoPSBT } from '@keystonehq/bc-ur-registry';
import { UREncoder, URDecoder, UR } from '@ngraveio/bc-ur';
import { createLogger } from './logger';

const log = createLogger('urPsbt');

// Maximum bytes per QR code fragment (lower = smaller QRs, more frames)
const DEFAULT_MAX_FRAGMENT_LENGTH = 100;
const PSBT_MAGIC_BYTES = [0x70, 0x73, 0x62, 0x74] as const;

function hasPsbtMagic(bytes: Buffer): boolean {
  return PSBT_MAGIC_BYTES.every((byte, index) => bytes[index] === byte);
}

function getPsbtBytesBase64(data: unknown): string | null {
  if (!(data instanceof Uint8Array || Buffer.isBuffer(data))) {
    return null;
  }

  const bytes = Buffer.from(data);
  return hasPsbtMagic(bytes) ? bytes.toString('base64') : null;
}

function getDataPropertyBytes(data: unknown): Uint8Array | Buffer | null {
  if (!data || typeof data !== 'object' || !('data' in data)) {
    return null;
  }

  const bytes = (data as { data: unknown }).data;
  return bytes instanceof Uint8Array || Buffer.isBuffer(bytes) ? bytes : null;
}

function decodeCryptoPsbtWrapper(cborData: unknown): string {
  const cryptoPsbt = CryptoPSBT.fromCBOR(cborData as Buffer);
  const psbtBuffer = cryptoPsbt.getPSBT();
  log.debug('Decoded PSBT via CryptoPSBT wrapper');
  return psbtBuffer.toString('base64');
}

function decodeCryptoPsbtPayload(cborData: unknown): string {
  const rawPsbt = getPsbtBytesBase64(cborData);
  if (rawPsbt) {
    log.debug('Decoded raw PSBT bytes from crypto-psbt');
    return rawPsbt;
  }

  try {
    return decodeCryptoPsbtWrapper(cborData);
  } catch (wrapperError) {
    log.warn('CryptoPSBT.fromCBOR failed, trying raw extraction', { error: wrapperError });
    const dataPropertyPsbt = getPsbtBytesBase64(getDataPropertyBytes(cborData));
    if (dataPropertyPsbt) {
      return dataPropertyPsbt;
    }

    throw wrapperError;
  }
}

function decodeBytesPayload(rawBytes: unknown): string {
  const bytes = Buffer.from(rawBytes as Uint8Array);
  const rawPsbt = getPsbtBytesBase64(bytes);
  if (rawPsbt) {
    return rawPsbt;
  }

  const textDecoder = new TextDecoder('utf-8');
  return textDecoder.decode(bytes);
}

function decodePsbtUrResult(ur: UR): string {
  const urType = ur.type.toLowerCase();

  log.debug('Decoding UR result', { type: urType });

  if (urType === 'crypto-psbt') {
    return decodeCryptoPsbtPayload(ur.decodeCBOR());
  }

  if (urType === 'bytes') {
    return decodeBytesPayload(ur.decodeCBOR());
  }

  throw new Error(`Unsupported UR type: ${urType}`);
}

/**
 * Encode a base64 PSBT into UR format frames for animated QR display
 *
 * @param psbtBase64 - The PSBT in base64 format
 * @param maxFragmentLength - Maximum bytes per fragment (default: 100)
 * @returns Array of UR strings for each QR frame
 */
export function encodePsbtToUrFrames(
  psbtBase64: string,
  maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH
): string[] {
  try {
    // Convert base64 to Buffer
    const psbtBuffer = Buffer.from(psbtBase64, 'base64');

    log.debug('Encoding PSBT to UR frames', {
      psbtLength: psbtBuffer.length,
      maxFragmentLength
    });

    // Create CryptoPSBT from the buffer
    const cryptoPsbt = new CryptoPSBT(psbtBuffer);

    // Get the CBOR-encoded data
    const cbor = cryptoPsbt.toCBOR();

    // Create UR from the CBOR data with type 'crypto-psbt'
    const ur = new UR(cbor, 'crypto-psbt');

    // Create encoder for fountain codes
    const encoder = new UREncoder(ur, maxFragmentLength);

    // Generate all unique fragments (for single-part, just 1 frame)
    // For fountain codes, we generate more frames than strictly needed
    // to allow recovery from any subset of frames
    const frames: string[] = [];
    const fragmentCount = encoder.fragmentsLength;

    if (fragmentCount === 1) {
      // Single-part encoding - just one frame needed
      frames.push(encoder.nextPart());
    } else {
      // Multi-part fountain encoding
      // Generate 2x the fragment count to ensure good coverage
      const totalFrames = Math.max(fragmentCount * 2, fragmentCount + 4);

      for (let i = 0; i < totalFrames; i++) {
        frames.push(encoder.nextPart());
      }
    }

    log.info('Encoded PSBT to UR frames', {
      frameCount: frames.length,
      fragmentCount,
      firstFrame: frames[0]?.substring(0, 50) + '...'
    });

    return frames;
  } catch (error) {
    log.error('Failed to encode PSBT to UR', { error });
    throw new Error(`Failed to encode PSBT: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get the total fragment count for a PSBT (for progress display)
 */
export function getPsbtFragmentCount(
  psbtBase64: string,
  maxFragmentLength: number = DEFAULT_MAX_FRAGMENT_LENGTH
): number {
  const psbtBuffer = Buffer.from(psbtBase64, 'base64');
  const cryptoPsbt = new CryptoPSBT(psbtBuffer);
  const cbor = cryptoPsbt.toCBOR();
  const ur = new UR(cbor, 'crypto-psbt');
  const encoder = new UREncoder(ur, maxFragmentLength);
  return encoder.fragmentsLength;
}

/**
 * Create a UR decoder for receiving signed PSBT QR codes
 */
export function createPsbtDecoder(): URDecoder {
  return new URDecoder();
}

/**
 * Feed a scanned UR string part to the decoder
 *
 * @returns Object with completion status and progress
 */
export function feedDecoderPart(
  decoder: URDecoder,
  urString: string
): { complete: boolean; progress: number; error?: string } {
  try {
    // Feed the part to the decoder
    decoder.receivePart(urString);

    const progress = Math.round(decoder.estimatedPercentComplete() * 100);
    const isComplete = decoder.isComplete();

    if (decoder.isError()) {
      return {
        complete: false,
        progress,
        error: decoder.resultError() || 'Decoding error'
      };
    }

    return { complete: isComplete, progress };
  } catch (error) {
    return {
      complete: false,
      progress: 0,
      error: error instanceof Error ? error.message : 'Failed to process QR code'
    };
  }
}

/**
 * Get the decoded PSBT from a completed decoder
 *
 * DEVICE FORMAT VARIATIONS (tested):
 * - Foundation Passport: Returns raw PSBT bytes directly in CBOR (no wrapper)
 * - Keystone: Uses CryptoPSBT wrapper
 * - SeedSigner: Uses CryptoPSBT wrapper
 *
 * This function handles all variations by checking for raw bytes first,
 * then falling back to the CryptoPSBT wrapper.
 *
 * @returns Base64-encoded signed PSBT
 */
export function getDecodedPsbt(decoder: URDecoder): string {
  if (!decoder.isComplete()) {
    throw new Error('Decoder is not complete');
  }

  if (!decoder.isSuccess()) {
    throw new Error(decoder.resultError() || 'Decoding failed');
  }

  try {
    return decodePsbtUrResult(decoder.resultUR());
  } catch (error) {
    log.error('Failed to decode PSBT from UR', { error });
    throw new Error(`Failed to decode PSBT: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Re-export UR format utilities from canonical location
export { isUrFormat, getUrType } from './urDeviceDecoder';
