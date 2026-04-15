import { PrismaClient } from '../../../../src/generated/prisma/client';

export async function assertExists<T>(
  tx: PrismaClient,
  model: keyof PrismaClient,
  where: Record<string, unknown>
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record = await (tx[model] as any).findFirst({ where });
  if (!record) {
    throw new Error(`Expected record to exist in ${String(model)} with ${JSON.stringify(where)}`);
  }
  return record as T;
}

export async function assertNotExists(
  tx: PrismaClient,
  model: keyof PrismaClient,
  where: Record<string, unknown>
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record = await (tx[model] as any).findFirst({ where });
  if (record) {
    throw new Error(`Expected no record in ${String(model)} with ${JSON.stringify(where)}`);
  }
}

export async function assertCount(
  tx: PrismaClient,
  model: keyof PrismaClient,
  expectedCount: number,
  where: Record<string, unknown> = {}
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = await (tx[model] as any).count({ where });
  if (count !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} records in ${String(model)}, found ${count}`
    );
  }
}
