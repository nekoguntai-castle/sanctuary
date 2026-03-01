/**
 * UR Decoder Module
 *
 * Handles UR format (Uniform Resources) QR code assembly including:
 * - Standard UR types (crypto-hdkey, crypto-output, etc.) via URRegistryDecoder
 * - ur:bytes format (Foundation Passport JSON export) via BytesURDecoder
 *
 * Both decoders support multi-part fountain code assembly with progress tracking.
 */

import { MutableRefObject } from 'react';
import { URRegistryDecoder } from '@keystonehq/bc-ur-registry';
import { URDecoder as BytesURDecoder } from '@ngraveio/bc-ur';
import {
  extractFromUrResult,
  extractFromUrBytesContent,
} from '../../utils/urDeviceDecoder';
import { createLogger } from '../../utils/logger';
import { DecoderCallbacks } from './types';

const log = createLogger('urDecoder');

/**
 * Process UR bytes format (Foundation Passport)
 *
 * Feeds a scanned part to the BytesURDecoder, tracks progress,
 * and extracts device data when assembly is complete.
 *
 * @returns true if decoding is complete and data was extracted
 */
export function processUrBytes(
  content: string,
  bytesDecoderRef: MutableRefObject<BytesURDecoder | null>,
  callbacks: DecoderCallbacks
): boolean {
  // Initialize bytes decoder if needed
  if (!bytesDecoderRef.current) {
    log.debug('Creating new BytesURDecoder for ur:bytes');
    bytesDecoderRef.current = new BytesURDecoder();
  }

  // Feed the part to the decoder
  const partReceived = bytesDecoderRef.current.receivePart(content);
  log.debug('Part received', { partReceived });

  // Check progress
  const progress = bytesDecoderRef.current.estimatedPercentComplete();
  const progressPercent = Math.round(progress * 100);
  callbacks.setUrProgress(progressPercent);

  const expectedCount = bytesDecoderRef.current.expectedPartCount();
  const receivedIndexes = bytesDecoderRef.current.receivedPartIndexes();
  const isComplete = bytesDecoderRef.current.isComplete() === true;

  log.info('UR bytes progress', { progress: progressPercent, received: receivedIndexes.length, expected: expectedCount });

  if (!isComplete) {
    return false; // Need more parts
  }

  // Decode complete
  log.info('UR bytes decode complete');
  callbacks.setCameraActive(false);
  callbacks.setScanning(true);
  callbacks.setError(null);

  if (!bytesDecoderRef.current.isSuccess()) {
    const errResult = bytesDecoderRef.current.resultError();
    throw new Error(`UR bytes decode failed: ${errResult || 'unknown error'}`);
  }

  // Get decoded UR and extract bytes
  const decodedUR = bytesDecoderRef.current.resultUR();
  const rawBytes = decodedUR.decodeCBOR();
  const textDecoder = new TextDecoder('utf-8');
  const textContent = textDecoder.decode(rawBytes);

  // Parse as JSON
  const extracted = extractFromUrBytesContent(textContent);
  if (extracted && extracted.xpub) {
    callbacks.setScanResult(callbacks.createScanResult(
      extracted.xpub,
      extracted.fingerprint,
      extracted.path
    ));
    callbacks.setScanning(false);
    callbacks.setUrProgress(0);
    bytesDecoderRef.current = null;
    log.info('UR bytes QR code parsed successfully');
    return true;
  }

  throw new Error('Could not extract xpub from ur:bytes content');
}

/**
 * Process standard UR format (crypto-hdkey, crypto-output, etc.)
 *
 * Feeds a scanned part to the URRegistryDecoder, tracks progress,
 * and extracts device data when assembly is complete.
 *
 * @returns true if decoding is complete and data was extracted
 */
export function processUrRegistry(
  content: string,
  urType: string,
  urDecoderRef: MutableRefObject<URRegistryDecoder | null>,
  callbacks: DecoderCallbacks
): boolean {
  // Initialize decoder if needed
  if (!urDecoderRef.current) {
    log.debug('Creating new URRegistryDecoder');
    urDecoderRef.current = new URRegistryDecoder();
  }

  // Feed the part
  urDecoderRef.current.receivePart(content);

  // Check progress
  const progress = urDecoderRef.current.estimatedPercentComplete();
  const progressPercent = Math.round(progress * 100);
  callbacks.setUrProgress(progressPercent);
  log.info('UR progress', { progress: progressPercent, isComplete: urDecoderRef.current.isComplete() });

  if (!urDecoderRef.current.isComplete()) {
    return false; // Need more parts
  }

  // Decode complete
  log.info('UR decode complete');
  callbacks.setCameraActive(false);
  callbacks.setScanning(true);
  callbacks.setError(null);

  if (!urDecoderRef.current.isSuccess()) {
    const errResult = urDecoderRef.current.resultError();
    throw new Error(`UR decode failed: ${errResult || 'unknown error'}`);
  }

  // Get decoded registry type
  const registryType = urDecoderRef.current.resultRegistryType();
  log.info('UR decoded', { type: registryType?.constructor?.name });

  const extracted = extractFromUrResult(registryType);
  if (extracted && extracted.xpub) {
    callbacks.setScanResult(callbacks.createScanResult(
      extracted.xpub,
      extracted.fingerprint,
      extracted.path
    ));
    callbacks.setScanning(false);
    callbacks.setUrProgress(0);
    urDecoderRef.current = null;
    log.info('UR QR code parsed successfully');
    return true;
  }

  throw new Error(`Could not extract xpub from UR type: ${registryType?.constructor?.name || urType}`);
}
