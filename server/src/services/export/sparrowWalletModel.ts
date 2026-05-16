import type { DeviceExportData } from './types';

export interface SparrowWalletModelInput {
  type?: string | null;
  modelSlug?: string | null;
  modelName?: string | null;
}

const SPARROW_WALLET_MODEL_BY_DEVICE_KEY: Record<string, string> = {
  // Coldcard variants
  coldcard: 'COLDCARD',
  coldcardmk4: 'COLDCARD',
  coldcard_mk3: 'COLDCARD',
  coldcard_mk4: 'COLDCARD',
  coldcard_q: 'COLDCARD',

  // Ledger variants
  ledger: 'LEDGER_NANO_S',
  ledger_nano: 'LEDGER_NANO_S',
  ledger_nano_s: 'LEDGER_NANO_S',
  ledger_nano_s_plus: 'LEDGER_NANO_S_PLUS',
  ledger_nano_x: 'LEDGER_NANO_X',
  ledger_stax: 'LEDGER_STAX',
  ledger_flex: 'LEDGER_FLEX',
  ledger_gen5: 'LEDGER_NANO_GEN5',
  ledger_gen_5: 'LEDGER_NANO_GEN5',
  ledger_nano_gen5: 'LEDGER_NANO_GEN5',
  ledger_nano_gen_5: 'LEDGER_NANO_GEN5',

  // Trezor variants
  trezor: 'TREZOR_1',
  trezor_one: 'TREZOR_1',
  trezor_model_one: 'TREZOR_1',
  trezor_t: 'TREZOR_T',
  trezor_model_t: 'TREZOR_T',
  trezor_safe_3: 'TREZOR_SAFE_3',
  trezor_safe_5: 'TREZOR_SAFE_5',
  trezor_safe_7: 'TREZOR_SAFE_5',

  // BitBox variants
  bitbox: 'BITBOX_02',
  bitbox02: 'BITBOX_02',
  bitbox02_btc_only: 'BITBOX_02',

  // Jade variants
  jade: 'JADE',
  blockstream_jade: 'JADE',
  blockstream_jade_plus: 'JADE',

  // SeedSigner
  seedsigner: 'SEEDSIGNER',

  // Foundation Passport variants
  passport: 'PASSPORT',
  foundation_passport: 'PASSPORT',
  foundation_passport_batch2: 'PASSPORT',

  // Keystone variants
  keystone: 'KEYSTONE',
  keystone_pro: 'KEYSTONE',
  keystone_essential: 'KEYSTONE',
  keystone_3_pro: 'KEYSTONE',

  // Other devices
  specter: 'SPECTER_DIY',

  // Generic fallbacks preserve the existing Sparrow export behavior.
  generic: 'COLDCARD',
  generic_sd: 'COLDCARD',
  generic_usb: 'COLDCARD',
};

function normalizeDeviceModelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getCandidateValues(input: SparrowWalletModelInput): string[] {
  return [
    input.modelSlug,
    input.modelName,
    input.type,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

export function mapDeviceToSparrowWalletModel(input: SparrowWalletModelInput): string {
  for (const candidate of getCandidateValues(input)) {
    const walletModel = SPARROW_WALLET_MODEL_BY_DEVICE_KEY[normalizeDeviceModelKey(candidate)];
    if (walletModel) return walletModel;
  }

  return 'COLDCARD';
}

export function mapDeviceTypeToSparrowWalletModel(deviceType: string): string {
  return mapDeviceToSparrowWalletModel({ type: deviceType });
}

export function mapExportDeviceToSparrowWalletModel(device: DeviceExportData): string {
  return mapDeviceToSparrowWalletModel(device);
}
