/**
 * Hardware Device Types
 *
 * Enums and interfaces for supported hardware wallet devices.
 */

export enum HardwareDevice {
  COLDCARD_MK4 = 'ColdCardMk4',
  COLDCARD_Q = 'ColdCard Q',
  TREZOR = 'Trezor',
  TREZOR_SAFE_7 = 'Trezor Safe 7',
  LEDGER = 'Ledger Nano',
  LEDGER_STAX = 'Ledger Stax',
  LEDGER_FLEX = 'Ledger Flex',
  LEDGER_GEN_5 = 'Ledger Gen 5',
  BITBOX = 'BitBox02',
  FOUNDATION_PASSPORT = 'Foundation Passport',
  BLOCKSTREAM_JADE = 'Blockstream Jade',
  KEYSTONE = 'Keystone',
  GENERIC = 'Generic SD',
}

export interface HardwareDeviceModel {
  id: string;
  name: string;
  slug: string;
  manufacturer: string;
  connectivity: string[];
  secureElement: boolean;
  openSource: boolean;
  airGapped: boolean;
  supportsBitcoinOnly: boolean;
  supportsMultisig: boolean;
  supportsTaproot: boolean;
  supportsPassphrase: boolean;
  scriptTypes: string[];
  hasScreen: boolean;
  screenType?: string;
  integrationTested: boolean;
  releaseYear?: number;
  discontinued: boolean;
  imageUrl?: string;
  websiteUrl?: string;
}
