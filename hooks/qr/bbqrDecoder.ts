/**
 * BBQr Decoder Module
 *
 * Handles BBQr format (Coldcard Q multi-part) QR code assembly.
 * Supports multi-part scanning with progress tracking and
 * decodes JSON file type content for device import.
 */

import { MutableRefObject } from 'react';
import { BBQrDecoder, BBQrFileTypes } from '../../services/bbqr';
import { parseDeviceJson } from '../../services/deviceParsers';
import { createLogger } from '../../utils/logger';
import { DecoderCallbacks } from './types';

const log = createLogger('bbqrDecoder');

/**
 * Process BBQr format (Coldcard Q)
 *
 * Feeds a scanned part to the BBQrDecoder, tracks progress,
 * and extracts device data when assembly is complete.
 * Only JSON file type is supported for device import.
 *
 * @returns true if decoding is complete and data was extracted
 */
export function processBBQr(
  content: string,
  bbqrDecoderRef: MutableRefObject<BBQrDecoder | null>,
  callbacks: DecoderCallbacks
): boolean {
  // Initialize decoder if needed
  if (!bbqrDecoderRef.current) {
    log.debug('Creating new BBQrDecoder');
    bbqrDecoderRef.current = new BBQrDecoder();
  }

  // Feed the part
  const accepted = bbqrDecoderRef.current.receivePart(content);
  if (!accepted) {
    const err = bbqrDecoderRef.current.getError();
    throw new Error(`BBQr error: ${err}`);
  }

  // Update progress
  const progress = bbqrDecoderRef.current.getProgress();
  callbacks.setUrProgress(progress);

  const received = bbqrDecoderRef.current.getReceivedCount();
  const total = bbqrDecoderRef.current.getTotalParts();
  const fileType = bbqrDecoderRef.current.getFileType();

  log.info('BBQr progress', {
    progress,
    received,
    total,
    fileType: fileType ? BBQrFileTypes[fileType] : 'unknown',
  });

  if (!bbqrDecoderRef.current.isComplete()) {
    return false; // Need more parts
  }

  // Decode complete
  log.info('BBQr decode complete');
  callbacks.setCameraActive(false);
  callbacks.setScanning(true);
  callbacks.setError(null);

  const decoded = bbqrDecoderRef.current.decode();
  bbqrDecoderRef.current = null;
  callbacks.setUrProgress(0);

  // For JSON file type, parse the content
  if (decoded.fileType === 'J' && decoded.text) {
    const parseResult = parseDeviceJson(decoded.text);
    if (parseResult && parseResult.xpub) {
      callbacks.setScanResult(callbacks.createScanResult(
        parseResult.xpub,
        parseResult.fingerprint || '',
        parseResult.derivationPath || '',
        parseResult.label,
        parseResult.accounts
      ));
      callbacks.setScanning(false);
      log.info('BBQr QR code parsed successfully', { format: parseResult.format });
      return true;
    }
    throw new Error('Could not extract xpub from BBQr JSON content');
  }

  throw new Error(
    `BBQr file type "${BBQrFileTypes[decoded.fileType]}" is not supported for device import. ` +
    'Please use the JSON export format from your Coldcard.'
  );
}
