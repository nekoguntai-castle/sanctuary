import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ImportValidationResult } from '../../../src/api/wallets';
import { ImportReview } from '../../../components/ImportWallet/ImportReview';

const createValidationResult = (
  overrides: Partial<ImportValidationResult> = {},
): ImportValidationResult => ({
  valid: true,
  format: 'descriptor',
  walletType: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  devices: [
    {
      fingerprint: 'aaaa1111',
      xpub: 'xpub1',
      derivationPath: "m/84'/0'/0'",
      existingDeviceId: 'device-1',
      existingDeviceLabel: 'Existing',
      willCreate: false,
      suggestedLabel: 'Existing',
      originalType: 'ledger',
    },
    {
      fingerprint: 'bbbb2222',
      xpub: 'xpub2',
      derivationPath: "m/84'/0'/1'",
      existingDeviceId: null,
      existingDeviceLabel: null,
      willCreate: true,
      suggestedLabel: 'New Device',
      originalType: 'coldcard',
    },
  ],
  ...overrides,
});

describe('ImportReview', () => {
  it('renders single signature wallet summary', () => {
    const validationResult = createValidationResult();

    render(
      <ImportReview
        validationResult={validationResult}
        walletName="Imported Wallet"
        network="mainnet"
        importError={null}
      />,
    );

    expect(screen.getByText('Confirm Import')).toBeInTheDocument();
    expect(screen.getByText('Imported Wallet')).toBeInTheDocument();
    expect(screen.getByText('Single Signature')).toBeInTheDocument();
    expect(screen.getByText('native segwit')).toBeInTheDocument();
    expect(screen.getByText('mainnet')).toBeInTheDocument();
    expect(screen.getByText('descriptor')).toBeInTheDocument();
    expect(screen.getByText('1 existing device will be reused')).toBeInTheDocument();
    expect(screen.getByText('1 new device will be created')).toBeInTheDocument();
  });

  it('renders multisig label and pluralized device text', () => {
    const validationResult = createValidationResult({
      walletType: 'multi_sig',
      quorum: 2,
      totalSigners: 3,
      devices: [
        {
          fingerprint: 'aaaa1111',
          xpub: 'xpub1',
          derivationPath: "m/48'/0'/0'/2'",
          existingDeviceId: 'device-1',
          existingDeviceLabel: 'Existing One',
          willCreate: false,
        },
        {
          fingerprint: 'bbbb2222',
          xpub: 'xpub2',
          derivationPath: "m/48'/0'/1'/2'",
          existingDeviceId: 'device-2',
          existingDeviceLabel: 'Existing Two',
          willCreate: false,
        },
        {
          fingerprint: 'cccc3333',
          xpub: 'xpub3',
          derivationPath: "m/48'/0'/2'/2'",
          existingDeviceId: null,
          existingDeviceLabel: null,
          willCreate: true,
        },
        {
          fingerprint: 'dddd4444',
          xpub: 'xpub4',
          derivationPath: "m/48'/0'/3'/2'",
          existingDeviceId: null,
          existingDeviceLabel: null,
          willCreate: true,
        },
      ],
    });

    render(
      <ImportReview
        validationResult={validationResult}
        walletName="2 of 3 Vault"
        network="testnet"
        importError={null}
      />,
    );

    expect(screen.getByText('2-of-3 Multisig')).toBeInTheDocument();
    expect(screen.getByText('2 existing devices will be reused')).toBeInTheDocument();
    expect(screen.getByText('2 new devices will be created')).toBeInTheDocument();
    expect(screen.getByText('testnet')).toBeInTheDocument();
  });

  it('hides device action rows when no devices are created or reused', () => {
    const validationResult = createValidationResult({
      devices: [],
    });

    render(
      <ImportReview
        validationResult={validationResult}
        walletName="No Device Changes"
        network="regtest"
        importError={null}
      />,
    );

    expect(screen.queryByText(/existing device/)).not.toBeInTheDocument();
    expect(screen.queryByText(/new device/)).not.toBeInTheDocument();
  });

  it('shows import error message when provided', () => {
    const validationResult = createValidationResult();

    render(
      <ImportReview
        validationResult={validationResult}
        walletName="Broken Import"
        network="mainnet"
        importError="Unable to import this wallet"
      />,
    );

    expect(screen.getByText('Unable to import this wallet')).toBeInTheDocument();
  });
});
