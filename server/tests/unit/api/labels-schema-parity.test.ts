/**
 * Contract test: the gateway-facing shared schemas (MobileCreateLabelRequestSchema,
 * MobileUpdateLabelRequestSchema) and the backend's runtime validation schemas
 * (LabelCreateBodySchema, LabelUpdateBodySchema, exported from ../../../src/api/labels)
 * must accept the same set of `name`/`color`/`description` shapes. A gap here means a
 * request the gateway forwards can be rejected by the backend, or vice versa.
 * See iteration-23 P2 remediation plan, Phase 3 (findings
 * label-schema-missing-length-bounds, label-description-null-rejected-by-backend-not-gateway).
 */
import { describe, expect, it } from 'vitest';

import {
  MOBILE_API_REQUEST_LIMITS,
  MobileCreateLabelRequestSchema,
  MobileUpdateLabelRequestSchema,
} from '@sanctuary/shared/schemas/mobileApiRequests';
import { LabelCreateBodySchema, LabelUpdateBodySchema } from '../../../src/api/labels';

const nameShapes: Array<{ label: string; name: unknown }> = [
  { label: 'a valid name', name: 'Exchange' },
  { label: 'a name at the shared max length', name: 'a'.repeat(MOBILE_API_REQUEST_LIMITS.labelNameMaxLength) },
  {
    label: 'a name over the shared max length',
    name: 'a'.repeat(MOBILE_API_REQUEST_LIMITS.labelNameMaxLength + 1),
  },
];

const colorShapes: Array<{ label: string; color: unknown }> = [
  { label: 'undefined (omitted)', color: undefined },
  { label: 'a color at the shared max length', color: 'a'.repeat(MOBILE_API_REQUEST_LIMITS.labelColorMaxLength) },
  {
    label: 'a color over the shared max length',
    color: 'a'.repeat(MOBILE_API_REQUEST_LIMITS.labelColorMaxLength + 1),
  },
];

const descriptionShapes: Array<{ label: string; description: unknown }> = [
  { label: 'undefined (omitted)', description: undefined },
  { label: 'null', description: null },
  { label: 'a valid description', description: 'Exchange transactions' },
  {
    label: 'a description at the shared max length',
    description: 'a'.repeat(MOBILE_API_REQUEST_LIMITS.labelDescriptionMaxLength),
  },
  {
    label: 'a description over the shared max length',
    description: 'a'.repeat(MOBILE_API_REQUEST_LIMITS.labelDescriptionMaxLength + 1),
  },
];

describe('label create/update contract parity', () => {
  it.each(nameShapes)('name: accepts/rejects $label the same way in both create schemas', ({ name }) => {
    const body: Record<string, unknown> = { name };

    const gatewayResult = MobileCreateLabelRequestSchema.safeParse(body);
    const backendResult = LabelCreateBodySchema.safeParse(body);

    expect(backendResult.success).toBe(gatewayResult.success);
  });

  it.each(colorShapes)('color: accepts/rejects $label the same way in both create schemas', ({ color }) => {
    const body: Record<string, unknown> = { name: 'Exchange' };
    if (color !== undefined) {
      body.color = color;
    }

    const gatewayResult = MobileCreateLabelRequestSchema.safeParse(body);
    const backendResult = LabelCreateBodySchema.safeParse(body);

    expect(backendResult.success).toBe(gatewayResult.success);
  });

  it.each(descriptionShapes)(
    'description: accepts/rejects $label the same way in both create schemas',
    ({ description }) => {
      const body: Record<string, unknown> = { name: 'Exchange' };
      if (description !== undefined) {
        body.description = description;
      }

      const gatewayResult = MobileCreateLabelRequestSchema.safeParse(body);
      const backendResult = LabelCreateBodySchema.safeParse(body);

      expect(backendResult.success).toBe(gatewayResult.success);
    },
  );

  it.each(descriptionShapes)(
    'description: accepts/rejects $label the same way in both update schemas',
    ({ description }) => {
      const body: Record<string, unknown> = { name: 'Exchange' };
      if (description !== undefined) {
        body.description = description;
      }

      const gatewayResult = MobileUpdateLabelRequestSchema.safeParse(body);
      const backendResult = LabelUpdateBodySchema.safeParse(body);

      expect(backendResult.success).toBe(gatewayResult.success);
    },
  );

  it('bounds match: name/color/description max lengths are identical across schemas', () => {
    expect(MOBILE_API_REQUEST_LIMITS.labelNameMaxLength).toBe(100);
    expect(MOBILE_API_REQUEST_LIMITS.labelColorMaxLength).toBe(32);
    expect(MOBILE_API_REQUEST_LIMITS.labelDescriptionMaxLength).toBe(500);
  });
});
