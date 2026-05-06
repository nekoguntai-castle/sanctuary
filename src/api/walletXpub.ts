import apiClient from './client';

export type XpubScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
export type XpubValidationNetwork = 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';

export interface ValidateXpubRequest {
  xpub: string;
  scriptType?: XpubScriptType;
  network?: XpubValidationNetwork;
  fingerprint?: string;
  accountPath?: string;
}

export interface ValidateXpubResponse {
  valid: true;
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
  return apiClient.post<ValidateXpubResponse>('/wallets/validate-xpub', data);
}
