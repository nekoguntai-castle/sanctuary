/**
 * Fetches the server-generated Coldcard multisig export that the Passport/Coldcard
 * QR must encode. The server validates quorum, signers and policy path, so the
 * client never builds this text itself.
 */

import { useEffect, useState } from 'react';
import * as walletsApi from '../../../api/wallets';
import { createLogger } from '../../../utils/logger';

const log = createLogger('usePassportMultisigExportText');

export const PASSPORT_EXPORT_ERROR =
  'This wallet cannot be exported as a Coldcard/Passport multisig config.';

interface PassportExportState {
  text: string | null;
  error: string | null;
  loading: boolean;
}

const IDLE_STATE: PassportExportState = { text: null, error: null, loading: false };
const LOADING_STATE: PassportExportState = { text: null, error: null, loading: true };

export function usePassportMultisigExportText(
  walletId: string,
  enabled: boolean
): PassportExportState {
  const [state, setState] = useState<PassportExportState>(LOADING_STATE);

  useEffect(() => {
    if (!enabled) return undefined;

    const controller = new AbortController();
    setState(LOADING_STATE);
    walletsApi
      .getWalletExportText(walletId, 'coldcard', controller.signal)
      .then((text) => {
        if (!controller.signal.aborted) setState({ text, error: null, loading: false });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        log.error('Failed to fetch Coldcard multisig export', { error: err });
        setState({ text: null, error: PASSPORT_EXPORT_ERROR, loading: false });
      });

    return () => controller.abort();
  }, [walletId, enabled]);

  return enabled ? state : IDLE_STATE;
}
