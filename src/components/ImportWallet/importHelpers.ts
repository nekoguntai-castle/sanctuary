import { ImportValidationResult } from '../../api/wallets';
import * as walletsApi from '../../api/wallets';
import { ApiError } from '../../api/client';
import {
  WalletScriptType,
  WalletType,
  type WalletScriptType as WalletScriptTypeValue,
} from '@sanctuary/shared/constants/walletIdentity';
import {
  buildCanonicalAccountPath,
  findWalletPolicy,
  parseCanonicalAccountPath,
  renderDescriptorWrapper,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  formatNetworkTitle,
  type TabNetwork,
} from '../../app/networks';
import { HARDWARE_WALLET_IMPLEMENTATION_INVENTORY } from '@sanctuary/shared/constants/hardwareWalletCapabilities';

// Input validation constants
export const MAX_INPUT_SIZE = 100 * 1024; // 100KB max input size
export const MAX_FILE_SIZE = 1024 * 1024; // 1MB max file size

export type ImportFormat = 'descriptor' | 'json' | 'hardware' | 'qr_code';
export type ScriptType = WalletScriptTypeValue;
export type HardwareDeviceType = 'ledger' | 'trezor' | 'jade';

export function getHardwareImportModelNames(type: HardwareDeviceType): readonly string[] {
  const inventory = HARDWARE_WALLET_IMPLEMENTATION_INVENTORY.find((row) => row.vendor === type);
  /* v8 ignore next -- HardwareDeviceType is generated from vendors with catalog models */
  if (!inventory || inventory.catalogModelNames.length === 0) {
    throw new Error(`No exact hardware models are registered for ${type}`);
  }
  return inventory.catalogModelNames;
}

export function getDefaultHardwareImportModel(type: HardwareDeviceType): string {
  return getHardwareImportModelNames(type)[0];
}

// Compute a canonical single-sig account path. Exact chain selection stays
// separate even where test chains share BIP44 coin type 1.
export const getDerivationPath = (
  scriptType: ScriptType,
  account: number,
  network: TabNetwork = 'mainnet',
): string => {
  return buildCanonicalAccountPath({
    walletType: WalletType.SINGLE_SIG,
    scriptType,
    chainEnvironment: network,
    account,
  });
};

// Helper: Build descriptor from xpub data
export const buildDescriptorFromXpub = (
  scriptType: ScriptType,
  fingerprint: string,
  path: string,
  xpub: string
): string => {
  const accountPath = parseCanonicalAccountPath(path);
  const policy = findWalletPolicy(WalletType.SINGLE_SIG, scriptType);
  if (!accountPath || !policy || accountPath.policy.id !== policy.id) {
    throw new Error('Derivation path does not match wallet script policy');
  }
  const pathParts = path.replace("m/", "").replace(/'/g, "h");
  const key = `[${fingerprint}/${pathParts}]${xpub}/<0;1>/*`;
  return renderDescriptorWrapper(policy.descriptorWrapper, key);
};

// Script type options
export const scriptTypeOptions: { value: ScriptType; label: string; description: string }[] = [
  { value: WalletScriptType.NATIVE_SEGWIT, label: 'Native SegWit', description: 'bc1q... addresses (Recommended)' },
  { value: WalletScriptType.NESTED_SEGWIT, label: 'Nested SegWit', description: '3... addresses' },
  { value: WalletScriptType.TAPROOT, label: 'Taproot', description: 'bc1p... addresses' },
  { value: WalletScriptType.LEGACY, label: 'Legacy', description: '1... addresses' },
];

// Validate input data size and basic format
export const validateInputData = (data: string, format: ImportFormat | null): string | null => {
  if (data.length > MAX_INPUT_SIZE) {
    return `Input too large (${(data.length / 1024).toFixed(1)}KB). Maximum allowed: ${MAX_INPUT_SIZE / 1024}KB. Please check you're importing the correct file.`;
  }

  // For JSON format, do a quick syntax check
  if (format === 'json' && data.trim().startsWith('{')) {
    try {
      JSON.parse(data);
    } catch (e) {
      // Only show JSON error if it looks like they're trying to paste JSON
      if (data.length > 500) {
        return 'Invalid JSON format. Please check the file contents.';
      }
    }
  }

  return null;
};

// Validate data with server API
export const validateImportData = async (
  format: ImportFormat | null,
  importData: string,
  walletName: string,
  setValidationResult: (result: ImportValidationResult | null) => void,
  setValidationError: (error: string | null) => void,
  setWalletName: (name: string) => void,
  activeNetwork?: TabNetwork,
  dataOverride?: string,
): Promise<boolean> => {
  setValidationError(null);

  const dataToValidate = dataOverride || importData;

  try {
    // Send data based on selected format - server auto-detects wallet export format
    // For hardware format, we send as descriptor since we built one from the xpub
    // For QR code format, try to detect if it's JSON or descriptor
    let sendAsJson = format === 'json' || format === 'qr_code';
    let sendAsDescriptor = format === 'descriptor' || format === 'hardware';

    // For QR code, check if data looks like a descriptor
    if (format === 'qr_code' && dataToValidate.trim()) {
      const descriptorPrefixes = ['wpkh(', 'wsh(', 'sh(', 'pkh(', 'tr('];
      if (descriptorPrefixes.some(p => dataToValidate.toLowerCase().startsWith(p))) {
        sendAsDescriptor = true;
        sendAsJson = false;
      }
    }

    const result = await walletsApi.validateImport({
      descriptor: sendAsDescriptor ? dataToValidate : undefined,
      json: sendAsJson ? dataToValidate : undefined,
      network: activeNetwork,
    });

    if (!result.valid) {
      setValidationError(result.error || 'Invalid import data');
      return false;
    }

    if (activeNetwork && result.network !== activeNetwork) {
      setValidationResult(null);
      setValidationError(
        `Imported wallet appears to be ${result.network}, but the sidebar network is ${formatNetworkTitle(activeNetwork)}. Switch networks in the sidebar and validate again.`
      );
      return false;
    }

    setValidationResult(result);

    // Auto-fill wallet name from suggested name if available and name is empty
    if (result.suggestedName && !walletName) {
      setWalletName(result.suggestedName);
    }

    return true;
  } catch (error) {
    if (error instanceof ApiError) {
      setValidationError(error.message);
    } else {
      setValidationError('Failed to validate import data');
    }
    return false;
  }
};
