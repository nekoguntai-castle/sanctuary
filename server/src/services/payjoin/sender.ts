/**
 * Payjoin Sender (BIP78)
 *
 * Attempt to send a Payjoin transaction by posting the original PSBT
 * to the receiver's endpoint and validating the returned proposal.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { validatePayjoinProposal } from '../bitcoin/psbtValidation';
import {
  OutboundResponseTooLargeError,
  requestPinnedAddress,
} from '../outboundNetwork/nativeRequest';
import { validatePayjoinUrl } from './ssrf';
import { PayjoinErrors } from './types';

const log = createLogger('PAYJOIN:SVC_SEND');
const PAYJOIN_RESPONSE_LIMIT_BYTES = 102_400;
const PAYJOIN_TIMEOUT_MS = 30_000;
const KNOWN_BIP78_ERRORS = new Set<string>(Object.values(PayjoinErrors));

/**
 * Attempt to send a Payjoin transaction
 *
 * Steps:
 * 1. Build original PSBT
 * 2. POST to receiver's Payjoin endpoint
 * 3. Validate the proposal
 * 4. Return proposal for signing
 */
export async function attemptPayjoinSend(
  originalPsbtBase64: string,
  payjoinUrl: string,
  senderInputIndices: number[],
  network: bitcoin.Network = bitcoin.networks.bitcoin
): Promise<{
  success: boolean;
  proposalPsbt?: string;
  isPayjoin: boolean;
  error?: string;
}> {
  try {
    log.info('Attempting Payjoin send');

    // Validate the Payjoin URL (SSRF protection)
    const urlValidation = await validatePayjoinUrl(payjoinUrl);
    if (!urlValidation.valid) {
      log.warn('Payjoin URL validation failed', { error: urlValidation.error });
      return {
        success: false,
        isPayjoin: false,
        error: urlValidation.error,
      };
    }

    const requestUrl = new URL(urlValidation.url.toString());
    requestUrl.searchParams.set('v', '1');

    const resolvedAddress = urlValidation.resolvedAddresses[0];
    const response = await requestPinnedAddress({
      url: requestUrl,
      resolvedAddress: resolvedAddress!.address,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: originalPsbtBase64,
      responseByteLimit: PAYJOIN_RESPONSE_LIMIT_BYTES,
      timeoutMs: PAYJOIN_TIMEOUT_MS,
    });

    if (!response.ok) {
      const errorCode = getKnownBip78Error(response.body);
      log.warn('Payjoin endpoint returned error', {
        status: response.status,
        errorCode: errorCode ?? 'unknown',
      });
      return payjoinFailure(errorCode
        ? `Payjoin endpoint error: ${errorCode}`
        : `Payjoin endpoint returned HTTP ${response.status}`);
    }

    const proposalBase64 = response.body.toString('utf8');

    // Validate the proposal
    const validation = validatePayjoinProposal(
      originalPsbtBase64,
      proposalBase64,
      senderInputIndices,
      network
    );

    if (!validation.valid) {
      log.warn('Payjoin proposal validation failed', { errors: validation.errors });
      return {
        success: false,
        isPayjoin: false,
        error: `Invalid proposal: ${validation.errors.join(', ')}`,
      };
    }

    if (validation.warnings.length > 0) {
      log.info('Payjoin proposal warnings', { warnings: validation.warnings });
    }

    log.info('Payjoin proposal received and validated');

    return {
      success: true,
      proposalPsbt: proposalBase64,
      isPayjoin: true,
    };
  } catch (error) {
    const safeError = getSafePayjoinRequestError(error);
    log.error('Payjoin send attempt failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      reason: safeError,
    });
    return payjoinFailure(safeError);
  }
}

function getKnownBip78Error(body: Buffer): string | null {
  const value = body.toString('utf8').trim();
  return KNOWN_BIP78_ERRORS.has(value) ? value : null;
}

function getSafePayjoinRequestError(error: unknown): string {
  if (error instanceof OutboundResponseTooLargeError) {
    return 'Payjoin response exceeded the allowed size';
  }
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('timeout')
    ? 'Payjoin request timeout'
    : 'Payjoin request failed';
}

function payjoinFailure(error: string) {
  return {
    success: false as const,
    isPayjoin: false as const,
    error,
  };
}
