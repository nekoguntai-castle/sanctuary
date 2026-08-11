import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import {
  WALLET_SCRIPT_TYPE_VALUES,
  WALLET_TYPE_VALUES,
} from '@sanctuary/shared/constants/walletIdentity';

const exactString = { type: 'string', minLength: 1, pattern: '^\\S(?:.*\\S)?$' } as const;
const fingerprint = { type: 'string', pattern: '^[0-9a-f]{8}$' } as const;
const lowercaseHex = { type: 'string', pattern: '^(?:[0-9a-f]{2})+$' } as const;
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
const decimalSatoshis = { type: 'string', pattern: '^(?:0|[1-9]\\d*)$' } as const;

export const psbtSigningContextSchemas = {
  PsbtSignerOrigin: {
    type: 'object',
    properties: {
      masterFingerprint: fingerprint,
      path: exactString,
      pubkey: lowercaseHex,
    },
    required: ['masterFingerprint', 'path', 'pubkey'],
    additionalProperties: false,
  },
  PsbtWalletSigner: {
    type: 'object',
    properties: {
      signerIndex: { type: 'integer', minimum: 0 },
      deviceId: exactString,
      deviceAccountId: exactString,
      masterFingerprint: fingerprint,
      accountPath: exactString,
      accountXpub: exactString,
    },
    required: [
      'signerIndex', 'deviceId', 'deviceAccountId', 'masterFingerprint',
      'accountPath', 'accountXpub',
    ],
    additionalProperties: false,
  },
  PsbtInputBinding: {
    type: 'object',
    properties: {
      inputIndex: { type: 'integer', minimum: 0 },
      txid: digest,
      vout: { type: 'integer', minimum: 0 },
      amountSats: decimalSatoshis,
      scriptPubKey: lowercaseHex,
      addressPath: exactString,
      signerOrigins: {
        type: 'array', minItems: 1,
        items: { $ref: '#/components/schemas/PsbtSignerOrigin' },
      },
    },
    required: [
      'inputIndex', 'txid', 'vout', 'amountSats', 'scriptPubKey',
      'addressPath', 'signerOrigins',
    ],
    additionalProperties: false,
  },
  PsbtChangeBinding: {
    type: 'object',
    properties: {
      outputIndex: { type: 'integer', minimum: 0 },
      amountSats: decimalSatoshis,
      scriptPubKey: lowercaseHex,
      addressPath: exactString,
      signerOrigins: {
        type: 'array', minItems: 1,
        items: { $ref: '#/components/schemas/PsbtSignerOrigin' },
      },
    },
    required: ['outputIndex', 'amountSats', 'scriptPubKey', 'addressPath', 'signerOrigins'],
    additionalProperties: false,
  },
  PsbtSigningContext: {
    type: 'object',
    properties: {
      version: { type: 'integer', enum: [1] },
      walletId: exactString,
      network: { type: 'string', enum: [...BITCOIN_NETWORKS] },
      walletType: { type: 'string', enum: [...WALLET_TYPE_VALUES] },
      scriptType: { type: 'string', enum: [...WALLET_SCRIPT_TYPE_VALUES] },
      canonicalPolicyId: exactString,
      canonicalPolicyVersion: { type: 'integer', minimum: 1 },
      descriptorDigest: digest,
      unsignedTransactionDigest: digest,
      signers: {
        type: 'array', minItems: 1,
        items: { $ref: '#/components/schemas/PsbtWalletSigner' },
      },
      inputs: {
        type: 'array', minItems: 1,
        items: { $ref: '#/components/schemas/PsbtInputBinding' },
      },
      changeOutputs: {
        type: 'array',
        items: { $ref: '#/components/schemas/PsbtChangeBinding' },
      },
    },
    required: [
      'version', 'walletId', 'network', 'walletType', 'scriptType',
      'canonicalPolicyId', 'canonicalPolicyVersion', 'descriptorDigest',
      'unsignedTransactionDigest', 'signers', 'inputs', 'changeOutputs',
    ],
    additionalProperties: false,
  },
} as const;
