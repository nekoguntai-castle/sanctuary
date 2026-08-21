import { runWalletSafetyAuditProcess } from '../src/services/walletSafetyAudit/processRunner';
import { runWalletSafetyAuditCli } from '../src/services/walletSafetyAudit/cli';
import { disconnect } from '../src/models/prisma';
import type { AuditProcessDependencies } from '../src/services/walletSafetyAudit/processRunner';

const defaultDependencies: AuditProcessDependencies = {
  runCli: runWalletSafetyAuditCli,
  disconnectDatabase: disconnect,
  stderr: (message) => process.stderr.write(`${message}\n`),
};

export const runWalletSafetyAuditScript = (
  dependencies: AuditProcessDependencies = defaultDependencies,
) => runWalletSafetyAuditProcess(dependencies);

if (require.main === module) {
  void runWalletSafetyAuditScript().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.stderr.write('Wallet safety audit process failed unexpectedly.\n');
    process.exitCode = 1;
  });
}
