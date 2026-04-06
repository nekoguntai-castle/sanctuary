import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL || '' });
const prisma = new PrismaClient({ adapter });

/**
 * Get the default initial password for the admin user.
 * This is a simple, well-known password that MUST be changed on first login.
 *
 * The user will be forced to change this password immediately after logging in
 * for the first time, so security is maintained while improving UX.
 */
function getDefaultPassword(): string {
  return 'sanctuary';
}

// Default admin user configuration (password generated at runtime)
const DEFAULT_ADMIN = {
  username: 'admin',
  isAdmin: true,
  preferences: {
    unit: 'sats',
    theme: 'sanctuary',
    darkMode: true,
    showFiat: true,
    background: 'zen',
    fiatCurrency: 'USD',
    priceProvider: 'auto',
  },
};

// Comprehensive list of hardware wallet models with their capabilities
const hardwareDeviceModels = [
  // ========================================
  // COINKITE (ColdCard)
  // ========================================
  {
    name: 'ColdCard Mk4',
    slug: 'coldcard-mk4',
    manufacturer: 'Coinkite',
    connectivity: ['usb', 'sd_card', 'nfc'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'oled',
    releaseYear: 2022,
    integrationTested: true,
    websiteUrl: 'https://coldcard.com',
  },
  {
    name: 'ColdCard Q',
    slug: 'coldcard-q',
    manufacturer: 'Coinkite',
    connectivity: ['usb', 'sd_card', 'qr_code', 'nfc'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2024,
    integrationTested: true,
    websiteUrl: 'https://coldcard.com',
  },
  {
    name: 'ColdCard Mk3',
    slug: 'coldcard-mk3',
    manufacturer: 'Coinkite',
    connectivity: ['usb', 'sd_card'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: false,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit'],
    hasScreen: true,
    screenType: 'oled',
    releaseYear: 2019,
    discontinued: true,
    integrationTested: true,
    websiteUrl: 'https://coldcard.com',
  },

  // ========================================
  // LEDGER
  // ========================================
  {
    name: 'Ledger Nano S Plus',
    slug: 'ledger-nano-s-plus',
    manufacturer: 'Ledger',
    connectivity: ['usb'],
    secureElement: true,
    openSource: false,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'oled',
    releaseYear: 2022,
    integrationTested: true,
    websiteUrl: 'https://ledger.com',
  },
  {
    name: 'Ledger Nano X',
    slug: 'ledger-nano-x',
    manufacturer: 'Ledger',
    connectivity: ['usb', 'bluetooth'],
    secureElement: true,
    openSource: false,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'oled',
    releaseYear: 2019,
    integrationTested: true,
    websiteUrl: 'https://ledger.com',
  },
  {
    name: 'Ledger Stax',
    slug: 'ledger-stax',
    manufacturer: 'Ledger',
    connectivity: ['usb', 'bluetooth', 'nfc'],
    secureElement: true,
    openSource: false,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'e-ink',
    releaseYear: 2023,
    integrationTested: true,
    websiteUrl: 'https://ledger.com',
  },
  {
    name: 'Ledger Flex',
    slug: 'ledger-flex',
    manufacturer: 'Ledger',
    connectivity: ['usb', 'bluetooth', 'nfc'],
    secureElement: true,
    openSource: false,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'e-ink',
    releaseYear: 2024,
    integrationTested: true,
    websiteUrl: 'https://ledger.com',
  },
  {
    name: 'Ledger Gen 5',
    slug: 'ledger-gen-5',
    manufacturer: 'Ledger',
    connectivity: ['usb', 'bluetooth', 'nfc'],
    secureElement: true,
    openSource: false,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'color-lcd',
    releaseYear: 2025,
    integrationTested: true,
    websiteUrl: 'https://ledger.com',
  },

  // ========================================
  // TREZOR
  // ========================================
  {
    name: 'Trezor Model One',
    slug: 'trezor-model-one',
    manufacturer: 'SatoshiLabs',
    connectivity: ['usb'],
    secureElement: false,
    openSource: true,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: false,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit'],
    hasScreen: true,
    screenType: 'oled',
    releaseYear: 2014,
    integrationTested: true,
    websiteUrl: 'https://trezor.io',
  },
  {
    name: 'Trezor Model T',
    slug: 'trezor-model-t',
    manufacturer: 'SatoshiLabs',
    connectivity: ['usb', 'sd_card'],
    secureElement: false,
    openSource: true,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2018,
    integrationTested: true,
    websiteUrl: 'https://trezor.io',
  },
  {
    name: 'Trezor Safe 3',
    slug: 'trezor-safe-3',
    manufacturer: 'SatoshiLabs',
    connectivity: ['usb'],
    secureElement: true,
    openSource: true,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'oled',
    releaseYear: 2023,
    integrationTested: true,
    websiteUrl: 'https://trezor.io',
  },
  {
    name: 'Trezor Safe 5',
    slug: 'trezor-safe-5',
    manufacturer: 'SatoshiLabs',
    connectivity: ['usb', 'nfc'],
    secureElement: true,
    openSource: true,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2024,
    integrationTested: true,
    websiteUrl: 'https://trezor.io',
  },
  {
    name: 'Trezor Safe 7',
    slug: 'trezor-safe-7',
    manufacturer: 'SatoshiLabs',
    connectivity: ['usb', 'nfc'],
    secureElement: true,
    openSource: true,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'color-lcd',
    releaseYear: 2025,
    integrationTested: true,
    websiteUrl: 'https://trezor.io',
  },

  // ========================================
  // FOUNDATION (Passport)
  // ========================================
  {
    name: 'Foundation Passport',
    slug: 'foundation-passport',
    manufacturer: 'Foundation Devices',
    connectivity: ['sd_card', 'qr_code'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2021,
    integrationTested: true,
    websiteUrl: 'https://foundationdevices.com',
  },
  {
    name: 'Foundation Passport Batch 2',
    slug: 'foundation-passport-batch2',
    manufacturer: 'Foundation Devices',
    connectivity: ['sd_card', 'qr_code'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2023,
    integrationTested: true,
    websiteUrl: 'https://foundationdevices.com',
  },

  // ========================================
  // BLOCKSTREAM (Jade)
  // ========================================
  {
    name: 'Blockstream Jade',
    slug: 'blockstream-jade',
    manufacturer: 'Blockstream',
    connectivity: ['usb', 'bluetooth', 'qr_code'],
    secureElement: false, // Uses blind oracle instead
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2021,
    websiteUrl: 'https://blockstream.com/jade',
  },
  {
    name: 'Blockstream Jade Plus',
    slug: 'blockstream-jade-plus',
    manufacturer: 'Blockstream',
    connectivity: ['usb', 'bluetooth', 'qr_code'],
    secureElement: false,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2024,
    websiteUrl: 'https://blockstream.com/jade',
  },

  // ========================================
  // BITBOX
  // ========================================
  {
    name: 'BitBox02',
    slug: 'bitbox02',
    manufacturer: 'Shift Crypto',
    connectivity: ['usb'],
    secureElement: true,
    openSource: true,
    airGapped: false,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'oled',
    releaseYear: 2019,
    websiteUrl: 'https://shiftcrypto.ch',
  },
  {
    name: 'BitBox02 Bitcoin-only',
    slug: 'bitbox02-btc-only',
    manufacturer: 'Shift Crypto',
    connectivity: ['usb'],
    secureElement: true,
    openSource: true,
    airGapped: false,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'oled',
    releaseYear: 2019,
    websiteUrl: 'https://shiftcrypto.ch',
  },

  // ========================================
  // KEYSTONE
  // ========================================
  {
    name: 'Keystone Pro',
    slug: 'keystone-pro',
    manufacturer: 'Keystone',
    connectivity: ['qr_code', 'sd_card'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2021,
    websiteUrl: 'https://keyst.one',
  },
  {
    name: 'Keystone 3 Pro',
    slug: 'keystone-3-pro',
    manufacturer: 'Keystone',
    connectivity: ['qr_code', 'sd_card', 'nfc'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2023,
    websiteUrl: 'https://keyst.one',
  },
  {
    name: 'Keystone Essential',
    slug: 'keystone-essential',
    manufacturer: 'Keystone',
    connectivity: ['qr_code'],
    secureElement: true,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: false,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2021,
    websiteUrl: 'https://keyst.one',
  },

  // ========================================
  // SEEDSIGNER
  // ========================================
  {
    name: 'SeedSigner',
    slug: 'seedsigner',
    manufacturer: 'SeedSigner',
    connectivity: ['qr_code'],
    secureElement: false,
    openSource: true,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: true,
    screenType: 'lcd',
    releaseYear: 2021,
    websiteUrl: 'https://seedsigner.com',
  },

  // ========================================
  // GENERIC / OTHER
  // ========================================
  {
    name: 'Generic SD Card',
    slug: 'generic-sd',
    manufacturer: 'Generic',
    connectivity: ['sd_card'],
    secureElement: false,
    openSource: false,
    airGapped: true,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: false,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: false,
    screenType: null,
    releaseYear: null,
    websiteUrl: null,
  },
  {
    name: 'Generic USB',
    slug: 'generic-usb',
    manufacturer: 'Generic',
    connectivity: ['usb'],
    secureElement: false,
    openSource: false,
    airGapped: false,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: false,
    scriptTypes: ['legacy', 'nested_segwit', 'native_segwit', 'taproot'],
    hasScreen: false,
    screenType: null,
    releaseYear: null,
    websiteUrl: null,
  },
];

async function main() {
  // ========================================
  // Create default node configuration
  // ========================================
  console.log('Creating default node configuration...');

  const existingNodeConfig = await prisma.nodeConfig.findFirst({
    where: { isDefault: true },
  });

  if (existingNodeConfig) {
    console.log('Default node configuration already exists, skipping...');
  } else {
    await prisma.nodeConfig.create({
      data: {
        id: 'default',
        type: 'electrum',
        host: 'electrum.blockstream.info',
        port: 50002,
        useSsl: true,
        explorerUrl: 'https://mempool.space',
        feeEstimatorUrl: 'https://mempool.space',
        isDefault: true,
      },
    });
    console.log('Created default node configuration (Blockstream public Electrum server)');
  }

  // ========================================
  // Create default admin user
  // ========================================
  console.log('Creating default admin user...');

  const existingAdmin = await prisma.user.findUnique({
    where: { username: DEFAULT_ADMIN.username },
  });

  if (existingAdmin) {
    console.log(`Default admin user '${DEFAULT_ADMIN.username}' already exists, skipping...`);
  } else {
    // Use the well-known default password
    // User will be REQUIRED to change this on first login
    const defaultPassword = getDefaultPassword();
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const adminUser = await prisma.user.create({
      data: {
        username: DEFAULT_ADMIN.username,
        password: hashedPassword,
        isAdmin: DEFAULT_ADMIN.isAdmin,
        preferences: DEFAULT_ADMIN.preferences,
      },
    });

    // Store a marker to track if the initial password has been changed
    // This allows us to force the user to change their password on first login
    await prisma.systemSetting.create({
      data: {
        key: `initialPassword_${adminUser.id}`,
        value: hashedPassword, // Store hash to compare later
      },
    });

    console.log(`Created default admin user: ${DEFAULT_ADMIN.username}`);
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║  INITIAL ADMIN CREDENTIALS                                         ║');
    console.log('╠════════════════════════════════════════════════════════════════════╣');
    console.log('║  Username: admin                                                   ║');
    console.log('║  Password: sanctuary                                               ║');
    console.log('║                                                                    ║');
    console.log('║  IMPORTANT: You will be required to change this password on        ║');
    console.log('║  first login for security.                                         ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝');
    console.log('');
  }

  // ========================================
  // Seed hardware device models
  // ========================================
  console.log('Seeding hardware device models...');

  for (const model of hardwareDeviceModels) {
    const existing = await prisma.hardwareDeviceModel.findUnique({
      where: { slug: model.slug },
    });

    if (existing) {
      // Update existing model
      await prisma.hardwareDeviceModel.update({
        where: { slug: model.slug },
        data: model,
      });
      console.log(`Updated: ${model.name}`);
    } else {
      // Create new model
      await prisma.hardwareDeviceModel.create({
        data: model,
      });
      console.log(`Created: ${model.name}`);
    }
  }

  console.log(`\nSeeded ${hardwareDeviceModels.length} hardware device models.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
