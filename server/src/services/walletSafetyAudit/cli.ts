import { runWalletSafetyAudit } from './runAudit';
import { WALLET_SAFETY_AUDIT_EXIT_CODES } from './schema';

interface AuditCliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

interface ParsedAuditCliArguments {
  outputPath: string;
}

const USAGE = 'Usage: npm run audit:wallet-safety -- --output <sensitive-report.json>';

export function parseAuditCliArguments(arguments_: readonly string[]): ParsedAuditCliArguments {
  if (arguments_.length !== 2 || arguments_[0] !== '--output' || !arguments_[1]?.trim()) {
    throw new Error('invalid arguments');
  }
  return { outputPath: arguments_[1] };
}

function redactedSummary(result: Awaited<ReturnType<typeof runWalletSafetyAudit>>): string {
  const summary = result.report.summary;
  return [
    `Wallet safety audit ${result.report.schemaVersion}:`,
    `wallets=${result.report.snapshot.walletCount};`,
    `proven_safe=${summary.provenSafe};`,
    `unsupported_but_recoverable=${summary.unsupportedButRecoverable};`,
    `manual_investigation=${summary.manualInvestigation};`,
    `findings=${summary.findingCount}.`,
    'Sensitive report written.',
  ].join(' ');
}

export async function runWalletSafetyAuditCli(
  arguments_: readonly string[] = process.argv.slice(2),
  io: AuditCliIo = {
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`),
  },
  executeAudit: typeof runWalletSafetyAudit = runWalletSafetyAudit,
): Promise<number> {
  if (arguments_.length === 1 && arguments_[0] === '--help') {
    io.stdout(USAGE);
    return WALLET_SAFETY_AUDIT_EXIT_CODES.clean;
  }

  try {
    const parsed = parseAuditCliArguments(arguments_);
    const result = await executeAudit(parsed);
    io.stdout(redactedSummary(result));
    return result.exitCode;
  } catch {
    // Audit errors can contain descriptors or extended public keys. Keep the
    // operator diagnostic stable and deliberately omit the raw exception.
    io.stderr(`Wallet safety audit failed. ${USAGE}`);
    return WALLET_SAFETY_AUDIT_EXIT_CODES.error;
  }
}
