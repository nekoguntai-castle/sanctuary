import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DIRECT_PRISMA_IMPORTS,
  getAllowedReason,
  isAllowedFile,
  scanContent,
} from '../../../scripts/check-prisma-imports';

describe('check-prisma-imports', () => {
  it('flags runtime imports from the Prisma singleton module', () => {
    expect(scanContent("import prisma from '../models/prisma';", 'src/services/example.ts')).toEqual([
      {
        file: 'src/services/example.ts',
        line: 1,
        content: "import prisma from '../models/prisma';",
      },
    ]);

    expect(scanContent("import { withTransaction } from '../../models/prisma';", 'src/services/example.ts')).toHaveLength(1);
    expect(scanContent("import prisma from '../models/prisma'; // direct runtime access", 'src/services/example.ts')).toHaveLength(1);
    expect(scanContent("export { withTransaction } from '../models/prisma';", 'src/services/example.ts')).toHaveLength(1);
    expect(scanContent("const prismaModule = await import('../models/prisma');", 'src/services/example.ts')).toHaveLength(1);
  });

  it('ignores type-only Prisma module imports', () => {
    expect(scanContent("import type { PrismaTxClient } from '../models/prisma';", 'src/services/example.ts')).toEqual([]);
    expect(scanContent("export type { PrismaTxClient } from '../models/prisma';", 'src/services/example.ts')).toEqual([]);
  });

  it('keeps runtime exceptions explicit and narrow', () => {
    expect(isAllowedFile('src/repositories/walletRepository.ts')).toBe(true);
    expect(getAllowedReason('src/services/backupService/creation.ts')).toBe(
      ALLOWED_DIRECT_PRISMA_IMPORTS['src/services/backupService/creation.ts']
    );
    expect(isAllowedFile('src/services/exampleService.ts')).toBe(false);
  });
});
