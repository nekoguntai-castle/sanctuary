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
import { validatePayjoinUrl } from './ssrf';

const log = createLogger('PAYJOIN:SVC_SEND');

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
    log.info('Attempting Payjoin send', { payjoinUrl });

    // Validate the Payjoin URL (SSRF protection)
    const urlValidation = await validatePayjoinUrl(payjoinUrl);
    if (!urlValidation.valid) {
      log.warn('Payjoin URL validation failed', { payjoinUrl, error: urlValidation.error });
      return {
        success: false,
        isPayjoin: false,
        error: urlValidation.error,
      };
    }

    const requestUrl = new URL(urlValidation.url.toString());
    requestUrl.searchParams.set('v', '1');

    // POST original PSBT to receiver
    // BIP78 requires a receiver-provided HTTPS endpoint; validatePayjoinUrl enforces SSRF controls before this request.
    const response = await fetch(requestUrl.toString(), { // lgtm[js/request-forgery]
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: originalPsbtBase64,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.warn('Payjoin endpoint returned error', { status: response.status, error: errorText });
      return {
        success: false,
        isPayjoin: false,
        error: `Payjoin endpoint error: ${errorText}`,
      };
    }

    const proposalBase64 = await response.text();

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
    log.error('Payjoin send attempt failed', { error: getErrorMessage(error) });
    return {
      success: false,
      isPayjoin: false,
      error: getErrorMessage(error, 'Payjoin failed'),
    };
  }
}
