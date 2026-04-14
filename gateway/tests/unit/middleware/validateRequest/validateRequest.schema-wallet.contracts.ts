import { expect, it } from 'vitest';

import {
  createDeviceSchema,
  draftUpdateSchema,
  labelSchema,
  mobilePermissionUpdateSchema,
  psbtBroadcastSchema,
  psbtCreateSchema,
  transactionBroadcastSchema,
  transactionCreateSchema,
  transactionEstimateSchema,
  updateDeviceSchema,
} from '../../../../src/middleware/validateRequest';

export function registerMobilePermissionUpdateSchemaContracts() {
  it('should validate mobile permission update payloads', () => {
    const result = mobilePermissionUpdateSchema.safeParse({
      broadcast: false,
      managePolicies: true,
    });

    expect(result.success).toBe(true);
  });

  it('should reject empty mobile permission update payloads', () => {
    const result = mobilePermissionUpdateSchema.safeParse({});

    expect(result.success).toBe(false);
  });
}

export function registerDraftUpdateSchemaContracts() {
  it('should validate draft update payloads', () => {
    const result = draftUpdateSchema.safeParse({
      signedPsbtBase64: 'cHNidP8BAHECAAAAAQ==',
      signedDeviceId: 'device-1',
      status: 'signed',
    });

    expect(result.success).toBe(true);
  });
}

export function registerTransactionAndPsbtSchemaContracts() {
  it('should validate transaction create payloads', () => {
    const result = transactionCreateSchema.safeParse({
      recipient: 'tb1qrecipient',
      amount: 10000,
      feeRate: 0.5,
    });

    expect(result.success).toBe(true);
  });

  it('should validate transaction estimate payloads', () => {
    const result = transactionEstimateSchema.safeParse({
      recipient: 'tb1qrecipient',
      amount: 10000,
      feeRate: 0.5,
    });

    expect(result.success).toBe(true);
  });

  it('should validate transaction broadcast payloads', () => {
    const result = transactionBroadcastSchema.safeParse({
      signedPsbtBase64: 'cHNi',
    });

    expect(result.success).toBe(true);
  });

  it('should validate PSBT create and broadcast payloads', () => {
    expect(psbtCreateSchema.safeParse({
      recipients: [{ address: 'tb1qrecipient', amount: 10000 }],
      feeRate: 0.5,
    }).success).toBe(true);
    expect(psbtBroadcastSchema.safeParse({
      signedPsbt: 'cHNi',
    }).success).toBe(true);
  });
}

export function registerDeviceSchemaContracts() {
  it('should validate device create and update payloads', () => {
    expect(createDeviceSchema.safeParse({
      type: 'trezor',
      label: 'My Trezor',
      fingerprint: 'abc12345',
      xpub: 'xpub-single',
    }).success).toBe(true);
    expect(updateDeviceSchema.safeParse({
      label: 'Updated Label',
    }).success).toBe(true);
  });
}

export function registerLabelSchemaContracts() {
  it('should validate backend label create payloads', () => {
    const result = labelSchema.safeParse({
      name: 'My Label',
      color: '#22c55e',
      description: 'Useful context',
    });

    expect(result.success).toBe(true);
  });
}
