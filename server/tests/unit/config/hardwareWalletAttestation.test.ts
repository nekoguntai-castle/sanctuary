import { afterEach, describe, expect, it, vi } from 'vitest';
import { HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK } from '@sanctuary/shared/constants/hardwareWalletCapabilities';
import {
  OPERATOR_ATTESTATION_ACK_ENV,
  OPERATOR_ATTESTED_VENDORS_ENV,
  buildHardwareWalletConfig,
} from '../../../src/config/hardwareWalletAttestation';

function build(vendors: string | undefined, ack: string | undefined) {
  const warn = vi.fn();
  const env: NodeJS.ProcessEnv = {};
  if (vendors !== undefined) env[OPERATOR_ATTESTED_VENDORS_ENV] = vendors;
  if (ack !== undefined) env[OPERATOR_ATTESTATION_ACK_ENV] = ack;
  return { config: buildHardwareWalletConfig(warn, env), warn };
}

describe('hardware wallet operator attestation config', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, '', ' , ,'])('is off and silent when the vendor list is %j', (vendors) => {
    const { config, warn } = build(vendors, HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK);

    expect(config.operatorAttestedVendors).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays off and silent when only the acknowledgement is set', () => {
    const { config, warn } = build(undefined, HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK);

    expect(config.operatorAttestedVendors).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    '',
    'yes',
    'NOT-TIER3-VERIFIED',
    ` ${HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK}`,
    `${HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK} `,
  ])('ignores the vendor list with one warning when the ack is %j', (ack) => {
    const { config, warn } = build('trezor', ack);

    expect(config.operatorAttestedVendors).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(OPERATOR_ATTESTATION_ACK_ENV);
  });

  it('activates trezor with exactly one boot warning', () => {
    const { config, warn } = build(' Trezor ,trezor', HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK);

    expect(config.operatorAttestedVendors).toEqual(['trezor']);
    expect(Object.isFrozen(config.operatorAttestedVendors)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('NOT Tier 3 verified'),
      { vendors: ['trezor'] },
    );
  });

  it('drops non-attestable vendors with a warning naming them', () => {
    const longVendor = 'x'.repeat(80);
    const { config, warn } = build(
      `ledger,trezor,JADE,${longVendor}`,
      HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK,
    );

    expect(config.operatorAttestedVendors).toEqual(['trezor']);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(1, expect.stringContaining('cannot be operator-attested'), {
      ignoredVendors: ['ledger', 'jade', 'x'.repeat(32)],
      attestableVendors: ['trezor'],
    });
    expect(warn).toHaveBeenNthCalledWith(2, expect.stringContaining('NOT Tier 3 verified'), {
      vendors: ['trezor'],
    });
  });

  it('stays off when every named vendor is non-attestable', () => {
    const { config, warn } = build('ledger', HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK);

    expect(config.operatorAttestedVendors).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('cannot be operator-attested');
  });

  it('rejects a separator other than a comma rather than guessing', () => {
    const { config } = build('trezor;ledger', HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK);

    expect(config.operatorAttestedVendors).toEqual([]);
  });

  it('reads process.env by default', () => {
    vi.stubEnv(OPERATOR_ATTESTED_VENDORS_ENV, 'trezor');
    vi.stubEnv(OPERATOR_ATTESTATION_ACK_ENV, HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK);

    expect(buildHardwareWalletConfig(vi.fn()).operatorAttestedVendors).toEqual(['trezor']);
  });

  it('is wired into the loaded server config', async () => {
    vi.resetModules();
    vi.stubEnv(OPERATOR_ATTESTED_VENDORS_ENV, 'trezor');
    vi.stubEnv(OPERATOR_ATTESTATION_ACK_ENV, HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK);

    const { getConfig } = await import('../../../src/config');

    expect(getConfig().hardwareWallet.operatorAttestedVendors).toEqual(['trezor']);
  });
});
