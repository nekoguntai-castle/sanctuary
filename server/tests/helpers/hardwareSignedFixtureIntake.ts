import {
  COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES,
  REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES,
  type HardwareSignedNegativeControlCase,
  type HardwareSignedPsbtVector,
  type HardwareSignedScriptType,
  type RequiredHardwareSignedRow,
  type UnsupportedHardwareSignedRow,
} from '../fixtures/hardware-signed-psbt-vectors';

export interface HardwareSignedFixtureIntakeIssue {
  vectorId: string;
  field: string;
  message: string;
}

const MULTISIG_SCRIPT_TYPES: HardwareSignedScriptType[] = ['p2wsh', 'p2sh-p2wsh'];
const SECRET_PATTERNS = [
  /seed words?/i,
  /mnemonic/i,
  /passphrase/i,
  /\bpin\b/i,
  /pairing secret/i,
  /auth token/i,
  /private key/i,
  /\b[xt]prv[1-9A-HJ-NP-Za-km-z]{20,}/,
];

const issue = (vectorId: string, field: string, message: string): HardwareSignedFixtureIntakeIssue => ({
  vectorId,
  field,
  message,
});

const rowKey = (row: RequiredHardwareSignedRow): string => `${row.vendor}:${row.scriptType}`;

const isMultisig = (scriptType: HardwareSignedScriptType): boolean => MULTISIG_SCRIPT_TYPES.includes(scriptType);

const requiredNegativeControls = (scriptType: HardwareSignedScriptType): HardwareSignedNegativeControlCase[] => {
  if (!isMultisig(scriptType)) return COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS;
  return [...COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS, ...MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS];
};

const missingValues = (required: readonly string[], actual: string[]): string[] => {
  const actualSet = new Set(actual);
  return required.filter(value => !actualSet.has(value));
};

const validateAddressEvidence = (vector: HardwareSignedPsbtVector): HardwareSignedFixtureIntakeIssue[] => {
  const coveredSuffixes = vector.addressEvidence
    .map(evidence => REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES.find(suffix => evidence.path.endsWith(suffix)))
    .filter((suffix): suffix is typeof REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES[number] => Boolean(suffix));
  const missing = missingValues(REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES, coveredSuffixes);
  const mismatches = vector.addressEvidence.filter(
    evidence => evidence.sanctuaryAddress !== evidence.deviceAddress || evidence.sanctuaryAddress !== evidence.coreAddress
  );

  return [
    ...missing.map(suffix => issue(vector.id, 'addressEvidence', `missing address evidence for ${suffix}`)),
    ...mismatches.map(evidence => issue(vector.id, 'addressEvidence', `address mismatch for ${evidence.path}`)),
  ];
};

const validateNegativeControls = (vector: HardwareSignedPsbtVector): HardwareSignedFixtureIntakeIssue[] => {
  const passedControls = vector.negativeControls
    .filter(control => control.passed && control.expectedFailure.trim() !== '' && control.observedFailure.trim() !== '')
    .map(control => control.caseName);
  return missingValues(requiredNegativeControls(vector.scriptType), passedControls)
    .map(caseName => issue(vector.id, 'negativeControls', `missing passed negative control ${caseName}`));
};

const validateSoftwareGates = (vector: HardwareSignedPsbtVector): HardwareSignedFixtureIntakeIssue[] => {
  const passedCommands = vector.softwareGates
    .filter(gate => gate.status === 'passed' && gate.capturedAt.trim() !== '')
    .map(gate => gate.command);
  return missingValues(REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES, passedCommands)
    .map(command => issue(vector.id, 'softwareGates', `missing passed software gate: ${command}`));
};

const validateSanitization = (vector: HardwareSignedPsbtVector): HardwareSignedFixtureIntakeIssue[] => {
  const review = vector.sanitization;
  const checks = [
    ['nonMainnetFunds', review.nonMainnetFunds],
    ['dedicatedOrWipeableDevice', review.dedicatedOrWipeableDevice],
    ['noSeedsPinsPassphrasesPairingSecrets', review.noSeedsPinsPassphrasesPairingSecrets],
    ['noHostAuthTokens', review.noHostAuthTokens],
    ['sanitizedArtifactsReviewed', review.sanitizedArtifactsReviewed],
  ] as const;
  const missingChecks = checks
    .filter(([, value]) => value !== true)
    .map(([field]) => issue(vector.id, `sanitization.${field}`, 'required sanitization check is not affirmed'));
  if (review.reviewer.trim() === '') {
    missingChecks.push(issue(vector.id, 'sanitization.reviewer', 'missing sanitization reviewer'));
  }
  return missingChecks;
};

const validateReplayEvidence = (vector: HardwareSignedPsbtVector): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  if ((vector.network as string) === 'mainnet') {
    issues.push(issue(vector.id, 'network', 'hardware fixture evidence must use regtest, signet, or testnet only'));
  }
  if (!vector.evidence.bitcoinCoreVersion?.trim()) {
    issues.push(issue(vector.id, 'evidence.bitcoinCoreVersion', 'missing Bitcoin Core replay version'));
  }
  if (vector.evidence.mempoolAcceptAllowed !== true) {
    issues.push(issue(vector.id, 'evidence.mempoolAcceptAllowed', 'Core testmempoolaccept must be allowed'));
  }
  return issues;
};

const collectStringValues = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStringValues);
  return [];
};

const validateSecretReview = (vector: HardwareSignedPsbtVector): HardwareSignedFixtureIntakeIssue[] => {
  const values = collectStringValues(vector);
  const matches = SECRET_PATTERNS.filter(pattern => values.some(value => pattern.test(value)));
  return matches.map(pattern => issue(vector.id, 'sanitization', `secret-shaped material matched ${pattern}`));
};

export function validateHardwareSignedFixtureIntake(
  vector: HardwareSignedPsbtVector
): HardwareSignedFixtureIntakeIssue[] {
  return [
    ...validateAddressEvidence(vector),
    ...validateNegativeControls(vector),
    ...validateSoftwareGates(vector),
    ...validateSanitization(vector),
    ...validateReplayEvidence(vector),
    ...validateSecretReview(vector),
  ];
}

export function assertHardwareSignedFixtureIntake(vector: HardwareSignedPsbtVector): void {
  const issues = validateHardwareSignedFixtureIntake(vector);
  if (issues.length === 0) return;

  throw new Error(
    `Hardware signed fixture ${vector.id || '<missing id>'} failed intake validation: `
      + issues.map(({ field, message }) => `${field}: ${message}`).join('; ')
  );
}

export function validateHardwareSignedFixtureSet(
  fixtures: HardwareSignedPsbtVector[],
  unsupportedRows: UnsupportedHardwareSignedRow[]
): HardwareSignedFixtureIntakeIssue[] {
  const seen = new Set<string>();
  const unsupported = new Set(unsupportedRows.map(rowKey));
  return fixtures.flatMap(vector => {
    const key = rowKey(vector);
    const issues = validateHardwareSignedFixtureIntake(vector);
    if (seen.has(key)) {
      issues.push(issue(vector.id, 'fixtureSet', `duplicate hardware fixture row ${key}`));
    }
    if (unsupported.has(key)) {
      issues.push(issue(vector.id, 'fixtureSet', `fixture row ${key} conflicts with unsupported product decision`));
    }
    seen.add(key);
    return issues;
  });
}
