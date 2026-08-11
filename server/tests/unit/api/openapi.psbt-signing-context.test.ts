import { describe, expect, it } from 'vitest';

import { openApiSpec } from './openapi.helpers';

const signingContextRef = { $ref: '#/components/schemas/PsbtSigningContext' };

describe('OpenAPI PSBT signing evidence contracts', () => {
  it('defines the immutable account and input binding evidence', () => {
    const context = openApiSpec.components.schemas.PsbtSigningContext;

    expect(context.additionalProperties).toBe(false);
    expect(context.required).toEqual(expect.arrayContaining([
      'walletId',
      'canonicalPolicyId',
      'descriptorDigest',
      'unsignedTransactionDigest',
      'signers',
      'inputs',
      'changeOutputs',
    ]));
    expect(context.properties.signers).toMatchObject({ type: 'array', minItems: 1 });
    expect(context.properties.inputs).toMatchObject({ type: 'array', minItems: 1 });
  });

  it.each([
    'TransactionCreateResponse',
    'TransactionBatchResponse',
    'PsbtCreateResponse',
    'RbfResponse',
    'CpfpResponse',
    'BatchTransactionResponse',
  ] as const)('requires signing evidence in %s', schemaName => {
    const schema = openApiSpec.components.schemas[schemaName];

    expect(schema.properties.signingContext).toEqual(signingContextRef);
    expect(schema.required).toContain('signingContext');
  });

  it('documents nullable legacy draft evidence and an atomic replacement Payjoin tuple', () => {
    expect(openApiSpec.components.schemas.DraftTransaction.properties.signingContext).toEqual({
      allOf: [signingContextRef],
      nullable: true,
    });
    const payjoinBranches = openApiSpec.components.schemas.PayjoinAttemptResponse.oneOf;
    const [success, fallback] = payjoinBranches;

    expect(success.properties.success.enum).toEqual([true]);
    expect(success.properties.signingContext).toEqual(signingContextRef);
    expect(success.required).toEqual(expect.arrayContaining([
      'success',
      'isPayjoin',
      'proposalPsbt',
      'signingContext',
      'intentId',
      'intentDigest',
    ]));
    expect(fallback.properties.success.enum).toEqual([false]);
    expect(fallback.required).toEqual(['success', 'isPayjoin']);
  });
});
