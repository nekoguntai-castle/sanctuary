import { runWalletSafetyAuditProcess } from '../src/services/walletSafetyAudit/processRunner';

void runWalletSafetyAuditProcess().then((exitCode) => {
  process.exitCode = exitCode;
}).catch(() => {
  process.stderr.write('Wallet safety audit process failed unexpectedly.\n');
  process.exitCode = 1;
});
