import { Prisma } from '../../../generated/prisma/client';

const isPlainRecord = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Convert a value into Prisma's JSON input domain without trusting a cast.
 * Undefined object fields are omitted; every other unsupported runtime value
 * fails closed before it can become durable signing evidence.
 */
export const toPrismaInputJson = (value: unknown): Prisma.InputJsonValue => {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map(item => item === null ? null : toPrismaInputJson(item));
  }
  if (value && typeof value === 'object' && isPlainRecord(value)) {
    const entries: Array<[string, Prisma.InputJsonValue | null]> = [];
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) continue;
      entries.push([key, nested === null ? null : toPrismaInputJson(nested)]);
    }
    return Object.fromEntries(entries);
  }
  throw new Error('Signing evidence contains a value that cannot be stored as JSON');
};
