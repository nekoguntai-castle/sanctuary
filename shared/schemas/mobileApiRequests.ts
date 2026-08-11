import { z } from 'zod';
import {
  ExactDeviceEvidenceStringSchema,
  MasterFingerprintSchema,
} from './deviceIdentity';
import { BITCOIN_NON_REGTEST_NETWORKS } from '../constants/bitcoin';
import {
  DEVICE_ACCOUNT_PURPOSE_VALUES,
  WALLET_SCRIPT_TYPE_VALUES,
} from '../constants/walletIdentity';
import { ACTIONABLE_DRAFT_STATUS_VALUES } from '../constants/drafts';
import { UpdateDraftRequestSchema } from './draftRequests';

/**
 * Shared mobile API request contracts consumed by gateway validation, backend
 * route validation, and OpenAPI schema definitions.
 */
export const MOBILE_ACTIONS = [
  'viewBalance',
  'viewTransactions',
  'viewUtxos',
  'createTransaction',
  'broadcast',
  'signPsbt',
  'generateAddress',
  'manageLabels',
  'manageDevices',
  'shareWallet',
  'deleteWallet',
  'approveTransaction',
  'managePolicies',
] as const;

export type MobileAction = typeof MOBILE_ACTIONS[number];

export const MOBILE_DRAFT_STATUS_VALUES = ACTIONABLE_DRAFT_STATUS_VALUES;
export const MOBILE_DEVICE_ACCOUNT_PURPOSES = DEVICE_ACCOUNT_PURPOSE_VALUES;
export const MOBILE_DEVICE_SCRIPT_TYPES = WALLET_SCRIPT_TYPE_VALUES;

export const MOBILE_API_REQUEST_LIMITS = {
  usernameMinLength: 1,
  usernameMaxLength: 50,
  loginPasswordMinLength: 1,
  refreshTokenMinLength: 1,
  deviceTokenMinLength: 1,
  deviceTokenMaxLength: 500,
  deviceNameMaxLength: 100,
  labelNameMinLength: 1,
  labelNameMaxLength: 100,
  labelColorMaxLength: 32,
  labelDescriptionMaxLength: 500,
  minFeeRate: 0.1,
} as const;

const feeRateMinimumMessage = `feeRate must be at least ${MOBILE_API_REQUEST_LIMITS.minFeeRate} sat/vB`;
const transactionEstimateRequiredMessage = 'recipient, amount, and feeRate are required';
const transactionBroadcastSourceRequiredMessage = 'Either signedPsbtBase64, rawTxHex, or draftId is required';
const transactionBroadcastExplicitSourceAmbiguousMessage = 'Provide either signedPsbtBase64 or rawTxHex, not both';
const psbtRecipientRequiredMessage = 'Each recipient must have address and amount';
const psbtSingleRecipientMessage = 'PSBT create supports exactly one recipient; use /transactions/batch for multiple recipients';
const deviceRequiredMessage = 'type, label, and fingerprint are required';
const deviceAccountRequiredMessage = 'Each account must have purpose, scriptType, derivationPath, and xpub';

export const USER_PREFERENCE_UNIT_VALUES = ['sats', 'btc'] as const;
export const USER_PREFERENCE_SELECTED_NETWORK_VALUES = [
  ...BITCOIN_NON_REGTEST_NETWORKS,
  'testnet',
] as const;

export const USER_PREFERENCE_LIMITS = {
  fiatCurrencyLength: 3,
  patternOpacityMin: 0,
  patternOpacityMax: 100,
  flyoutOpacityMin: 50,
  flyoutOpacityMax: 100,
  notificationVolumeMin: 0,
  notificationVolumeMax: 100,
} as const;

const fiatCurrencyMessage = 'fiatCurrency must be a 3-letter ISO 4217 currency code';
const fiatCurrencySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, fiatCurrencyMessage);

const eventSoundPreferenceSchema = z.object({
  enabled: z.boolean().optional(),
  sound: z.string().optional(),
}).passthrough();

const notificationSoundsPreferenceSchema = z.object({
  enabled: z.boolean().optional(),
  volume: z
    .number()
    .min(USER_PREFERENCE_LIMITS.notificationVolumeMin)
    .max(USER_PREFERENCE_LIMITS.notificationVolumeMax)
    .optional(),
  confirmation: eventSoundPreferenceSchema.optional(),
  receive: eventSoundPreferenceSchema.optional(),
  send: eventSoundPreferenceSchema.optional(),
  confirmationChime: z.boolean().optional(),
  soundType: z.string().optional(),
}).passthrough();

export const UserPreferencesPatchSchema = z.object({
  darkMode: z.boolean().optional(),
  theme: z.string().optional(),
  background: z.string().optional(),
  unit: z.enum(USER_PREFERENCE_UNIT_VALUES).optional(),
  fiatCurrency: fiatCurrencySchema.optional(),
  showFiat: z.boolean().optional(),
  priceProvider: z.string().optional(),
  contrastLevel: z.number().optional(),
  patternOpacity: z
    .number()
    .min(USER_PREFERENCE_LIMITS.patternOpacityMin)
    .max(USER_PREFERENCE_LIMITS.patternOpacityMax)
    .optional(),
  flyoutOpacity: z
    .number()
    .min(USER_PREFERENCE_LIMITS.flyoutOpacityMin)
    .max(USER_PREFERENCE_LIMITS.flyoutOpacityMax)
    .optional(),
  selectedNetwork: z.enum(USER_PREFERENCE_SELECTED_NETWORK_VALUES).optional(),
  favoriteBackgrounds: z.array(z.string()).optional(),
  favoriteThemes: z.array(z.string()).optional(),
  seasonalBackgrounds: z.record(z.string(), z.string()).optional(),
  notificationSounds: notificationSoundsPreferenceSchema.optional(),
  telegram: z.record(z.string(), z.unknown()).optional(),
  viewSettings: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type UserPreferencesPatch = z.infer<typeof UserPreferencesPatchSchema>;

/**
 * Normalizes preference values with canonical storage forms. Gateway
 * validation intentionally does not depend on this helper because proxied
 * request bodies are not rewritten there; backend persistence applies it
 * after merging defaults, existing preferences, and the incoming patch.
 */
export function canonicalizeUserPreferencesPatch(
  preferences: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...preferences,
    ...(typeof preferences.fiatCurrency === 'string'
      ? { fiatCurrency: preferences.fiatCurrency.trim().toUpperCase() }
      : {}),
    ...(preferences.selectedNetwork === 'testnet'
      ? { selectedNetwork: 'testnet3' }
      : {}),
  };
}

export const MobileLoginRequestSchema = z.object({
  username: z
    .string()
    .min(MOBILE_API_REQUEST_LIMITS.usernameMinLength, 'Username is required')
    .max(MOBILE_API_REQUEST_LIMITS.usernameMaxLength, 'Username too long'),
  password: z
    .string()
    .min(MOBILE_API_REQUEST_LIMITS.loginPasswordMinLength, 'Password is required'),
});

export const MobileRefreshTokenRequestSchema = z.object({
  refreshToken: z
    .string()
    .min(MOBILE_API_REQUEST_LIMITS.refreshTokenMinLength, 'Refresh token is required'),
  rotate: z
    .boolean()
    .optional(),
});

export const MobileLogoutRequestSchema = z.object({
  refreshToken: z
    .string()
    .optional(),
});

export const MobileTwoFactorVerifyRequestSchema = z.object({
  tempToken: z
    .string()
    .min(1, 'Temporary token is required'),
  code: z
    .string()
    .min(1, 'Code is required'),
});

export const MobileUserPreferencesRequestSchema = UserPreferencesPatchSchema;

export const MobilePushRegisterRequestSchema = z.object({
  token: z
    .string({ message: 'Device token is required' })
    .min(MOBILE_API_REQUEST_LIMITS.deviceTokenMinLength, 'Device token is required')
    .max(MOBILE_API_REQUEST_LIMITS.deviceTokenMaxLength, 'Device token too long'),
  platform: z
    .enum(['ios', 'android'], {
      message: 'Platform must be ios or android',
    }),
  deviceName: z
    .string()
    .max(MOBILE_API_REQUEST_LIMITS.deviceNameMaxLength, 'Device name too long')
    .optional(),
});

export const MobilePushUnregisterRequestSchema = z.object({
  token: z
    .string({ message: 'Device token is required' })
    .min(MOBILE_API_REQUEST_LIMITS.deviceTokenMinLength, 'Device token is required')
    .max(MOBILE_API_REQUEST_LIMITS.deviceTokenMaxLength, 'Device token too long'),
});

export const MobileCreateLabelRequestSchema = z.object({
  name: z
    .string()
    .min(MOBILE_API_REQUEST_LIMITS.labelNameMinLength, 'Label name is required')
    .max(MOBILE_API_REQUEST_LIMITS.labelNameMaxLength, 'Label name too long'),
  color: z
    .string()
    .max(MOBILE_API_REQUEST_LIMITS.labelColorMaxLength, 'Label color too long')
    .optional(),
  description: z
    .string()
    .max(MOBILE_API_REQUEST_LIMITS.labelDescriptionMaxLength, 'Label description too long')
    .optional()
    .nullable(),
});

export const MobileUpdateLabelRequestSchema = z.object({
  name: z
    .string()
    .min(MOBILE_API_REQUEST_LIMITS.labelNameMinLength, 'Label name is required')
    .max(MOBILE_API_REQUEST_LIMITS.labelNameMaxLength, 'Label name too long')
    .optional(),
  color: z
    .string()
    .max(MOBILE_API_REQUEST_LIMITS.labelColorMaxLength, 'Label color too long')
    .optional(),
  description: z
    .string()
    .max(MOBILE_API_REQUEST_LIMITS.labelDescriptionMaxLength, 'Label description too long')
    .optional()
    .nullable(),
});

const mobilePermissionUpdateShape = MOBILE_ACTIONS.reduce(
  (shape, action) => {
    shape[action] = z.boolean().optional();
    return shape;
  },
  {} as Record<MobileAction, z.ZodOptional<z.ZodBoolean>>
);

export const MobilePermissionUpdateRequestSchema = z
  .object(mobilePermissionUpdateShape)
  .strict()
  .refine(
    (permissions) => Object.keys(permissions).length > 0,
    'At least one permission must be provided'
  );

export const MobileDraftUpdateRequestSchema = UpdateDraftRequestSchema;

export const MobileUtxoReferenceSchema = z.object({
  txid: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Invalid transaction ID'),
  vout: z.number().int().min(0),
});

const MobileTransactionMetadataSchema = z.object({
  label: z.string().optional(),
  memo: z.string().optional(),
});

const MobileDecoyOutputsRequestSchema = z.object({
  enabled: z.boolean(),
  count: z.number().int().min(0),
});

export const MobileTransactionCreateRequestSchema = MobileTransactionMetadataSchema.extend({
  recipient: z.string({ message: 'recipient is required' }).min(1, 'recipient is required'),
  amount: z.number({ message: 'amount is required' }).min(1, 'amount is required'),
  feeRate: z.number({ message: 'feeRate is required' }).min(
    MOBILE_API_REQUEST_LIMITS.minFeeRate,
    feeRateMinimumMessage
  ),
  selectedUtxoIds: z.array(z.string()).optional(),
  enableRBF: z.boolean().optional(),
  sendMax: z.boolean().optional(),
  subtractFees: z.boolean().optional(),
  decoyOutputs: MobileDecoyOutputsRequestSchema.optional(),
});

export const MobileTransactionEstimateRequestSchema = z.object({
  recipient: z
    .string({ message: transactionEstimateRequiredMessage })
    .min(1, transactionEstimateRequiredMessage),
  amount: z
    .number({ message: transactionEstimateRequiredMessage })
    .min(1, transactionEstimateRequiredMessage),
  feeRate: z.number({ message: transactionEstimateRequiredMessage }).min(
    MOBILE_API_REQUEST_LIMITS.minFeeRate,
    feeRateMinimumMessage
  ),
  selectedUtxoIds: z.array(z.string()).optional(),
});

export const MobileTransactionBroadcastRequestSchema = MobileTransactionMetadataSchema.extend({
  signedPsbtBase64: z.string().min(1).optional(),
  rawTxHex: z.string().min(1).optional(),
  draftId: z.string().min(1).optional(),
  recipient: z.string().optional(),
  amount: z.number().optional(),
  fee: z.number().optional(),
  utxos: z.array(MobileUtxoReferenceSchema).optional(),
  intentId: z.string().min(1).optional(),
  intentDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).refine(
  (request) => Boolean(request.signedPsbtBase64 || request.rawTxHex || request.draftId),
  transactionBroadcastSourceRequiredMessage
).refine(
  (request) => !(request.signedPsbtBase64 && request.rawTxHex),
  {
    message: transactionBroadcastExplicitSourceAmbiguousMessage,
    path: ['rawTxHex'],
  }
).refine(
  request => Boolean(request.draftId) || Boolean(request.intentId && request.intentDigest),
  { message: 'A signing intent is required', path: ['intentId'] }
).refine(
  request => Boolean(request.intentId) === Boolean(request.intentDigest),
  { message: 'intentId and intentDigest must be provided together', path: ['intentDigest'] }
);

const MobilePsbtRecipientSchema = z.object({
  address: z.string({ message: psbtRecipientRequiredMessage }).min(1, psbtRecipientRequiredMessage),
  amount: z.number({ message: psbtRecipientRequiredMessage }).min(1, psbtRecipientRequiredMessage),
});

export const MobilePsbtCreateRequestSchema = z.object({
  recipients: z
    .array(MobilePsbtRecipientSchema, { message: 'recipients array is required' })
    .min(1, 'recipients array is required')
    .max(1, psbtSingleRecipientMessage),
  feeRate: z.number({ message: 'feeRate is required' }).min(
    MOBILE_API_REQUEST_LIMITS.minFeeRate,
    feeRateMinimumMessage
  ),
  utxoIds: z.array(z.string()).optional(),
});

export const MobilePsbtBroadcastRequestSchema = MobileTransactionMetadataSchema.extend({
  signedPsbt: z.string({ message: 'signedPsbt is required' }).min(1, 'signedPsbt is required'),
  intentId: z.string().min(1),
  intentDigest: z.string().regex(/^[0-9a-f]{64}$/),
});

export const MobileDeviceAccountRequestSchema = z.object({
  purpose: z.enum(MOBILE_DEVICE_ACCOUNT_PURPOSES, { message: deviceAccountRequiredMessage }),
  scriptType: z.enum(MOBILE_DEVICE_SCRIPT_TYPES, { message: deviceAccountRequiredMessage }),
  derivationPath: ExactDeviceEvidenceStringSchema,
  xpub: ExactDeviceEvidenceStringSchema,
});

export const MobileCreateDeviceRequestSchema = z.object({
  type: z.string({ message: deviceRequiredMessage }).min(1, deviceRequiredMessage),
  label: z.string({ message: deviceRequiredMessage }).min(1, deviceRequiredMessage),
  fingerprint: z.string({ message: deviceRequiredMessage }).pipe(MasterFingerprintSchema),
  xpub: ExactDeviceEvidenceStringSchema.optional(),
  derivationPath: ExactDeviceEvidenceStringSchema.optional(),
  modelSlug: z.string().min(1).optional(),
  accounts: z.array(MobileDeviceAccountRequestSchema).optional(),
  merge: z.boolean().optional(),
}).refine(
  (request) => Boolean(request.xpub || (request.accounts && request.accounts.length > 0)),
  'Either xpub or accounts array is required'
).refine(
  request => Boolean(request.xpub) === Boolean(request.derivationPath),
  'Legacy xpub and derivationPath must be provided together'
);

export const MobileUpdateDeviceRequestSchema = z.object({
  label: z.string().min(1).optional(),
  derivationPath: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  modelSlug: z.string().min(1).optional(),
});

export type MobileLoginRequest = z.infer<typeof MobileLoginRequestSchema>;
export type MobileRefreshTokenRequest = z.infer<typeof MobileRefreshTokenRequestSchema>;
export type MobileLogoutRequest = z.infer<typeof MobileLogoutRequestSchema>;
export type MobileTwoFactorVerifyRequest = z.infer<typeof MobileTwoFactorVerifyRequestSchema>;
export type MobileUserPreferencesRequest = z.infer<typeof MobileUserPreferencesRequestSchema>;
export type MobilePushRegisterRequest = z.infer<typeof MobilePushRegisterRequestSchema>;
export type MobilePushUnregisterRequest = z.infer<typeof MobilePushUnregisterRequestSchema>;
export type MobileCreateLabelRequest = z.infer<typeof MobileCreateLabelRequestSchema>;
export type MobileUpdateLabelRequest = z.infer<typeof MobileUpdateLabelRequestSchema>;
export type MobilePermissionUpdateRequest = z.infer<typeof MobilePermissionUpdateRequestSchema>;
export type MobileDraftUpdateRequest = z.infer<typeof MobileDraftUpdateRequestSchema>;
export type MobileUtxoReference = z.infer<typeof MobileUtxoReferenceSchema>;
export type MobileTransactionCreateRequest = z.infer<typeof MobileTransactionCreateRequestSchema>;
export type MobileTransactionEstimateRequest = z.infer<typeof MobileTransactionEstimateRequestSchema>;
export type MobileTransactionBroadcastRequest = z.infer<typeof MobileTransactionBroadcastRequestSchema>;
export type MobilePsbtCreateRequest = z.infer<typeof MobilePsbtCreateRequestSchema>;
export type MobilePsbtBroadcastRequest = z.infer<typeof MobilePsbtBroadcastRequestSchema>;
export type MobileDeviceAccountRequest = z.infer<typeof MobileDeviceAccountRequestSchema>;
export type MobileCreateDeviceRequest = z.infer<typeof MobileCreateDeviceRequestSchema>;
export type MobileUpdateDeviceRequest = z.infer<typeof MobileUpdateDeviceRequestSchema>;
