import {
  loadWalletSafetyRawSnapshot,
  type RawAuditDatabaseClient,
} from '../../repositories/walletSafetyAuditRepository';
import { buildWalletSafetyAuditReport, reportHasFindings } from './analyzer';
import { writeSensitiveAuditReport } from './reportWriter';
import {
  WALLET_SAFETY_AUDIT_EXIT_CODES,
  type WalletSafetyAuditReport,
} from './schema';

interface RunWalletSafetyAuditOptions {
  outputPath: string;
  client?: RawAuditDatabaseClient;
  generatedAt?: Date;
  writeReport?: (outputPath: string, report: WalletSafetyAuditReport) => Promise<void>;
}

export interface WalletSafetyAuditRunResult {
  exitCode: 0 | 2;
  report: WalletSafetyAuditReport;
}

export async function runWalletSafetyAudit(
  options: RunWalletSafetyAuditOptions,
): Promise<WalletSafetyAuditRunResult> {
  const snapshot = await loadWalletSafetyRawSnapshot(options.client);
  const report = buildWalletSafetyAuditReport(snapshot, options.generatedAt);
  await (options.writeReport ?? writeSensitiveAuditReport)(options.outputPath, report);
  return {
    exitCode: reportHasFindings(report)
      ? WALLET_SAFETY_AUDIT_EXIT_CODES.findings
      : WALLET_SAFETY_AUDIT_EXIT_CODES.clean,
    report,
  };
}
