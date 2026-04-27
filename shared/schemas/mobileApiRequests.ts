import { z } from 'zod';

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

export const MOBILE_DRAFT_STATUS_VALUES = ['unsigned', 'partial', 'signed'] as const;
export const MOBILE_DEVICE_ACCOUNT_PURPOSES = ['single_sig', 'multisig'] as const;
export const MOBILE_DEVICE_SCRIPT_TYPES = ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] as const;

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
const psbtRecipientRequiredMessage = 'Each recipient must have address and amount';
const deviceRequiredMessage = 'type, label, and fingerprint are required';
const deviceAccountRequiredMessage = 'Each account must have purpose, scriptType, derivationPath, and xpub';

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

export const MobileUserPreferencesRequestSchema = z.object({
  darkMode: z.boolean().optional(),
  theme: z.string().optional(),
  background: z.string().optional(),
  unit: z.enum(['btc', 'sats', 'mbtc']).optional(),
  fiatCurrency: z.string().length(3).toUpperCase().optional(),
  showFiat: z.boolean().optional(),
  priceProvider: z.string().optional(),
  flyoutOpacity: z.number().min(50).max(100).optional(),
  notificationSounds: z.object({
    enabled: z.boolean().optional(),
    volume: z.number().min(0).max(100).optional(),
    confirmation: z.object({
      enabled: z.boolean().optional(),
      sound: z.string().optional(),
    }).optional(),
    receive: z.object({
      enabled: z.boolean().optional(),
      sound: z.string().optional(),
    }).optional(),
    send: z.object({
      enabled: z.boolean().optional(),
      sound: z.string().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

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

export const MobileDraftUpdateRequestSchema = z.object({
  signedPsbtBase64: z.string().min(1).optional(),
  signedDeviceId: z.string().min(1).optional(),
  status: z.enum(MOBILE_DRAFT_STATUS_VALUES).optional(),
  label: z.string().optional(),
  memo: z.string().optional(),
}).strict();

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
  recipient: z.string().optional(),
  amount: z.number().optional(),
  fee: z.number().optional(),
  utxos: z.array(MobileUtxoReferenceSchema).optional(),
}).refine(
  (request) => Boolean(request.signedPsbtBase64 || request.rawTxHex),
  'Either signedPsbtBase64 or rawTxHex is required'
);

const MobilePsbtRecipientSchema = z.object({
  address: z.string({ message: psbtRecipientRequiredMessage }).min(1, psbtRecipientRequiredMessage),
  amount: z.number({ message: psbtRecipientRequiredMessage }).min(1, psbtRecipientRequiredMessage),
});

export const MobilePsbtCreateRequestSchema = z.object({
  recipients: z
    .array(MobilePsbtRecipientSchema, { message: 'recipients array is required' })
    .min(1, 'recipients array is required'),
  feeRate: z.number({ message: 'feeRate is required' }).min(
    MOBILE_API_REQUEST_LIMITS.minFeeRate,
    feeRateMinimumMessage
  ),
  utxoIds: z.array(z.string()).optional(),
});

export const MobilePsbtBroadcastRequestSchema = MobileTransactionMetadataSchema.extend({
  signedPsbt: z.string({ message: 'signedPsbt is required' }).min(1, 'signedPsbt is required'),
});

export const MobileDeviceAccountRequestSchema = z.object({
  purpose: z.enum(MOBILE_DEVICE_ACCOUNT_PURPOSES, { message: deviceAccountRequiredMessage }),
  scriptType: z.enum(MOBILE_DEVICE_SCRIPT_TYPES, { message: deviceAccountRequiredMessage }),
  derivationPath: z.string({ message: deviceAccountRequiredMessage }).min(1, deviceAccountRequiredMessage),
  xpub: z.string({ message: deviceAccountRequiredMessage }).min(1, deviceAccountRequiredMessage),
});

export const MobileCreateDeviceRequestSchema = z.object({
  type: z.string({ message: deviceRequiredMessage }).min(1, deviceRequiredMessage),
  label: z.string({ message: deviceRequiredMessage }).min(1, deviceRequiredMessage),
  fingerprint: z.string({ message: deviceRequiredMessage }).min(1, deviceRequiredMessage),
  xpub: z.string().min(1).optional(),
  derivationPath: z.string().min(1).optional(),
  modelSlug: z.string().min(1).optional(),
  accounts: z.array(MobileDeviceAccountRequestSchema).optional(),
  merge: z.boolean().optional(),
}).refine(
  (request) => Boolean(request.xpub || (request.accounts && request.accounts.length > 0)),
  'Either xpub or accounts array is required'
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
