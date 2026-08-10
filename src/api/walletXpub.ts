import apiClient from './client';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import type { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { ValidateXpubResponseSchema } from '@sanctuary/shared/schemas/walletResponses';

export type XpubScriptType = WalletScriptType;
export type XpubValidationNetwork = NetworkType;

export interface ValidateXpubRequest {
  xpub: string;
  scriptType?: XpubScriptType;
  network?: XpubValidationNetwork;
  fingerprint: string;
  accountPath: string;
}

export interface ValidateXpubResponse {
  valid: true;
  /** Exact BIP389 receive/change multipath descriptor accepted by wallet import. */
  descriptor: string;
  scriptType: XpubScriptType;
  firstAddress: string;
  xpub: string;
  fingerprint: string;
  accountPath: string;
}

/**
 * Validate an extended public key and return the server-generated descriptor preview.
 * The caller supplies the key, network, script type, and optional origin metadata.
 */
export async function validateXpub(data: ValidateXpubRequest): Promise<ValidateXpubResponse> {
  // The declared type is `valid: true` — a literal that cannot express a
  // failure — and what comes back becomes wallet key material.
  return apiClient.post<ValidateXpubResponse>('/wallets/validate-xpub', data, {
    schema: ValidateXpubResponseSchema,
  });
}
