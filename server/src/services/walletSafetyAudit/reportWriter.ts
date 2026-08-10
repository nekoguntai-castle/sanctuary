import { randomUUID } from 'node:crypto';
import { dirname, basename, join } from 'node:path';
import { open, rename, unlink } from 'node:fs/promises';
import {
  walletSafetyAuditReportSchema,
  type WalletSafetyAuditReport,
} from './schema';

export async function writeSensitiveAuditReport(
  outputPath: string,
  report: WalletSafetyAuditReport,
): Promise<void> {
  const validated = walletSafetyAuditReportSchema.parse(report);
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    file = await open(temporaryPath, 'wx', 0o600);
    await file.writeFile(`${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    await file.chmod(0o600);
    await file.sync();
    await file.close();
    file = null;
    await rename(temporaryPath, outputPath);
  } catch (error) {
    if (file) await file.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
