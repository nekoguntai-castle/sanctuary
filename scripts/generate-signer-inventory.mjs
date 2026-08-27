#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT_PATH = 'config/hardware-wallet-implementation-inventory.json';

export const SOURCE_PATHS = Object.freeze({
  persistedDevice: 'server/prisma/schema.prisma',
  deviceTypes: 'src/services/hardwareWallet/types.ts',
  uiDeviceEnum: 'src/types/hardware.ts',
  catalog: 'server/prisma/seed.ts',
  adapters: 'src/services/hardwareWallet/runtime.ts',
  parsers: 'src/services/deviceParsers/index.ts',
  importHandlers: 'server/src/services/import/index.ts',
  exportHandlers: 'server/src/services/export/index.ts',
  uiImportTypes: 'src/components/ImportWallet/importHelpers.ts',
  uiSigningMethods: 'src/components/send/steps/review/deviceCapabilities.ts',
  qrAirgapCodec: 'src/utils/urPsbt.ts',
  serverCapabilityEnforcement: 'server/src',
  capabilityManifest: 'shared/constants/hardwareWalletCapabilities.ts',
  clientFundsExecution: 'src',
  serverBitcoinExecution: 'server/src/services/bitcoin',
  serverTransactionEntryPoints: 'server/src/api/transactions',
});

const ALL_CAPABILITIES = Object.freeze([
  'import',
  'account_add',
  'display',
  'sign',
  'finalize',
  'broadcast',
]);

const KNOWN_VENDORS = new Set([
  'bitbox', 'coldcard', 'generic', 'jade', 'keystone',
  'ledger', 'passport', 'seedsigner', 'specter', 'trezor',
]);

const DEVICE_IDENTITY_VENDORS = Object.freeze({
  bitbox: 'bitbox',
  BitBox02: 'bitbox',
  'Blockstream Jade': 'jade',
  coldcard: 'coldcard',
  ColdCardMk4: 'coldcard',
  'ColdCard Q': 'coldcard',
  'Foundation Passport': 'passport',
  'Generic SD': 'generic',
  jade: 'jade',
  'Keystone': 'keystone',
  ledger: 'ledger',
  'Ledger Nano': 'ledger',
  'Ledger Stax': 'ledger',
  'Ledger Flex': 'ledger',
  'Ledger Gen 5': 'ledger',
  passport: 'passport',
  trezor: 'trezor',
  Trezor: 'trezor',
  'Trezor Safe 7': 'trezor',
});

const MANUFACTURER_VENDORS = Object.freeze({
  Blockstream: 'jade',
  Coinkite: 'coldcard',
  'Foundation Devices': 'passport',
  Generic: 'generic',
  Keystone: 'keystone',
  Ledger: 'ledger',
  SatoshiLabs: 'trezor',
  SeedSigner: 'seedsigner',
  'Shift Crypto': 'bitbox',
});

const EXPORT_HANDLER_VENDORS = Object.freeze({
  bluewalletHandler: ['coldcard', 'generic'],
  coldcardHandler: ['coldcard'],
  descriptorHandler: ['generic'],
  sparrowHandler: ['generic', 'specter'],
});

/**
 * Independently reviewed funds-controlling server boundaries. Discovery alone
 * is deletion-vacuous: removing an assertion would merely shrink generated
 * output. Exact comparison against this projection makes both missing and
 * unexpected assertion calls require an explicit review update.
 */
export const REQUIRED_SERVER_CAPABILITY_BOUNDARIES = Object.freeze([
  ['server/src/api/bitcoin/transactions.ts', 'assertUnscopedRawTransactionBroadcastDisabled', 'broadcast', 1],
  ['server/src/api/bitcoin/transactions.ts', 'assertWalletHardwareCapabilityById', 'sign', 3],
  ['server/src/api/devices/accounts.ts', 'assertHardwareWalletCapability', 'account_add', 1],
  ['server/src/api/devices/crud.ts', 'assertHardwareWalletCapability', 'account_add', 2],
  ['server/src/api/transactions/addresses.ts', 'assertWalletHardwareCapabilityById', 'display', 2],
  ['server/src/api/transactions/drafting.ts', 'assertWalletHardwareCapabilityById', 'sign', 3],
  ['server/src/api/wallets/export.ts', 'assertWalletHardwareCapabilityById', 'display', 1],
  ['server/src/assistant/tools/walletReadTools.ts', 'assertWalletHardwareCapabilityById', 'display', 1],
  ['server/src/mcp/resources/index.ts', 'assertWalletHardwareCapabilityById', 'display', 1],
  ['server/src/services/addressDisplaySafety.ts', 'assertWalletHardwareCapabilityById', 'display', 2],
  ['server/src/services/agentApiService.ts', 'assertWalletHardwareCapabilityById', 'sign', 1],
  ['server/src/services/agentOperationalAddressService.ts', 'assertWalletHardwareCapabilityById', 'display', 1],
  ['server/src/services/bitcoin/signingIntent/artifactValidation.ts', 'assertWalletHardwareCapabilityById', 'finalize', 1],
  ['server/src/services/bitcoin/signingIntent/artifactValidation.ts', 'assertWalletHardwareCapabilityById', 'sign', 1],
  ['server/src/services/bitcoin/sync/addressDiscovery.ts', 'assertWalletHardwareCapabilityById', 'display', 1],
  ['server/src/services/bitcoin/transactions/broadcasting.ts', 'assertWalletHardwareCapabilityById', 'broadcast', 1],
  ['server/src/services/deviceAccountRegistration.ts', 'assertHardwareWalletCapability', 'account_add', 1],
  ['server/src/services/deviceRegistration.ts', 'assertHardwareWalletCapability', 'import', 2],
  ['server/src/services/payjoin/receiver.ts', 'assertWalletHardwareCapabilityById', 'sign', 1],
  ['server/src/services/wallet/addressGeneration.ts', 'assertWalletHardwareCapabilityById', 'display', 1],
  ['server/src/services/wallet/walletCreate.ts', 'assertHardwareWalletCapability', 'import', 1],
  ['server/src/services/wallet/walletDevices.ts', 'assertHardwareWalletCapability', 'account_add', 1],
  ['server/src/services/wallet/walletDevices.ts', 'assertWalletHardwareCapability', 'account_add', 1],
  ['server/src/services/wallet/walletMutations.ts', 'assertWalletHardwareCapabilityById', 'display', 1],
  ['server/src/services/wallet/walletQueries.ts', 'assertWalletHardwareCapabilityById', 'display', 1],
  ['server/src/services/walletImport/walletImportService.ts', 'assertHardwareWalletCapability', 'import', 2],
]);

export const REQUIRED_FUNDS_EXECUTION_POINTS = Object.freeze([
  ['server/src/api/transactions/broadcasting.ts', 'broadcastValidated', 'broadcast', 'callable', 1],
  ['server/src/services/bitcoin/blockchain/networkOperations.ts', 'broadcastAuthenticatedRawTransaction', 'broadcast', 'callable', 1],
  ['server/src/services/bitcoin/blockchain/networkOperations.ts', 'broadcastTransaction', 'broadcast', 'callable', 1],
  ['server/src/services/bitcoin/electrum/electrumClient.ts', 'broadcastTransaction', 'broadcast', 'callable', 1],
  ['server/src/services/bitcoin/electrum/methods.ts', 'broadcastTransaction', 'broadcast', 'callable', 1],
  ['server/src/services/bitcoin/electrum/publicApi.ts', 'broadcastTransaction', 'broadcast', 'callable', 1],
  ['server/src/services/bitcoin/pooledNodeClient.ts', 'broadcastTransaction', 'broadcast', 'callable', 1],
  ['server/src/services/bitcoin/psbtBuilder/multisigFinalization.ts', 'finalizeMultisigInput', 'finalize', 'callable', 1],
  ['server/src/services/bitcoin/signingIntent/artifactValidation.ts', 'finalizeInput', 'finalize', 'operation', 1],
  ['server/src/services/bitcoin/signingIntent/artifactValidation.ts', 'finalizePsbt', 'finalize', 'callable', 1],
  ['server/src/services/bitcoin/signingIntent/service.ts', 'broadcastReplay', 'broadcast', 'callable', 1],
  ['server/src/services/bitcoin/transactions/broadcasting.ts', 'broadcastAndSave', 'broadcast', 'callable', 1],
  ['src/api/transactions/transactions.ts', 'broadcastTransaction', 'broadcast', 'callable', 1],
  ['src/api/bitcoin.ts', 'broadcastRawNetworkTransaction', 'broadcast', 'callable', 1],
  ['src/components/send/SendTransactionWizard/useSendWizardActionHandlers.ts', 'broadcastSignedRawTx', 'broadcast', 'callable', 1],
  ['src/components/send/SendTransactionWizard/useSendWizardActionHandlers.ts', 'broadcastUploadedSignedPsbt', 'broadcast', 'callable', 1],
  ['src/components/send/SendTransactionWizard/useSendWizardActionHandlers.ts', 'broadcastWithConnectedHardwareWallet', 'broadcast', 'callable', 1],
  ['src/hooks/send/useBroadcast.ts', 'broadcastTransaction', 'broadcast', 'callable', 1],
  ['src/hooks/send/useQrSigning.ts', 'processQrSignedPsbt', 'sign', 'callable', 1],
  ['src/hooks/send/useQrSigning.ts', 'uploadSignedPsbt', 'sign', 'callable', 1],
  ['src/hooks/send/useUsbSigning.ts', 'signPsbtWithDevice', 'sign', 'callable', 1],
  ['src/hooks/send/useUsbSigning.ts', 'signWithDevice', 'sign', 'callable', 1],
  ['src/hooks/send/useUsbSigning.ts', 'signWithHardwareWallet', 'sign', 'callable', 1],
  ['src/hooks/send/useUsbSigning.ts', 'signWithHardwareWalletResult', 'sign', 'callable', 1],
  ['src/hooks/useHardwareWallet.ts', 'signPSBT', 'sign', 'callable', 1],
  ['src/services/hardwareWallet/adapters/bitbox/bitboxAdapter.ts', 'signPSBT', 'sign', 'callable', 1],
  ['src/services/hardwareWallet/adapters/bitbox/signPsbt.ts', 'finalizeAllInputs', 'finalize', 'operation', 1],
  ['src/services/hardwareWallet/adapters/bitbox/signPsbt.ts', 'signPsbtWithBitBox', 'sign', 'callable', 1],
  ['src/services/hardwareWallet/adapters/jade.ts', 'signPSBT', 'sign', 'callable', 1],
  ['src/services/hardwareWallet/adapters/jadeProtocol.ts', 'signPsbt', 'sign', 'callable', 1],
  ['src/services/hardwareWallet/adapters/ledger/ledgerAdapter.ts', 'signPSBT', 'sign', 'callable', 1],
  ['src/services/hardwareWallet/adapters/ledger/signPsbt.ts', 'finalizeAllInputs', 'finalize', 'operation', 1],
  ['src/services/hardwareWallet/adapters/ledger/signPsbt.ts', 'signPsbt', 'sign', 'callable', 1],
  ['src/services/hardwareWallet/adapters/trezor/signPsbt.ts', 'signPsbtWithTrezor', 'sign', 'callable', 1],
  ['src/services/hardwareWallet/adapters/trezor/signPsbtValidation.ts', 'finalizeAllInputs', 'finalize', 'operation', 1],
  ['src/services/hardwareWallet/adapters/trezor/trezorAdapter.ts', 'signPSBT', 'sign', 'callable', 1],
  ['src/services/hardwareWallet/service.ts', 'broadcastSignedTransaction', 'broadcast', 'callable', 1],
  ['src/services/hardwareWallet/service.ts', 'signPSBT', 'sign', 'callable', 1],
]);

const readRepositoryFile = (path) => readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8');

function parseTypeScript(path, readFile) {
  const scriptKind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, readFile(path), ts.ScriptTarget.Latest, true, scriptKind);
}

function unwrap(expression) {
  if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) {
    return unwrap(expression.expression);
  }
  return expression;
}

function stringLiteral(node, context) {
  const value = unwrap(node);
  if (!ts.isStringLiteralLike(value)) throw new Error(`Expected string literal for ${context}`);
  return value.text;
}

function property(object, name, context) {
  const entry = object.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate)
      && ((ts.isIdentifier(candidate.name) && candidate.name.text === name)
        || (ts.isStringLiteralLike(candidate.name) && candidate.name.text === name)));
  if (!entry || !ts.isPropertyAssignment(entry)) throw new Error(`Missing ${name} in ${context}`);
  return entry.initializer;
}

function arrayStrings(node, context) {
  const value = unwrap(node);
  if (!ts.isArrayLiteralExpression(value)) throw new Error(`Expected array for ${context}`);
  return value.elements.map((element) => stringLiteral(element, context));
}

function variableInitializer(source, name) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
        return unwrap(declaration.initializer);
      }
    }
  }
  throw new Error(`Missing semantic inventory declaration: ${name}`);
}

function typeAlias(source, name) {
  const declaration = source.statements.find((statement) =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
  if (!declaration || !ts.isTypeAliasDeclaration(declaration)) {
    throw new Error(`Missing semantic type declaration: ${name}`);
  }
  return declaration.type;
}

function unionStrings(source, name) {
  const type = typeAlias(source, name);
  const nodes = ts.isUnionTypeNode(type) ? type.types : [type];
  return nodes.map((node) => {
    if (!ts.isLiteralTypeNode(node)) throw new Error(`${name} must contain only literal identities`);
    return stringLiteral(node.literal, name);
  });
}

function enumValues(source, name) {
  const declaration = source.statements.find((statement) =>
    ts.isEnumDeclaration(statement) && statement.name.text === name);
  if (!declaration || !ts.isEnumDeclaration(declaration)) throw new Error(`Missing enum ${name}`);
  return declaration.members.map((member) => {
    if (!member.initializer) throw new Error(`${name} members require explicit values`);
    return stringLiteral(member.initializer, name);
  });
}

function objectArray(source, name) {
  const value = variableInitializer(source, name);
  if (!ts.isArrayLiteralExpression(value)) throw new Error(`${name} must be an array literal`);
  return value.elements.map((element) => {
    const object = unwrap(element);
    if (!ts.isObjectLiteralExpression(object)) throw new Error(`${name} entries must be object literals`);
    return object;
  });
}

function registeredValues(source, registryName, methodName = 'register', argumentKind = 'identifier') {
  const registrations = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === registryName
      && node.expression.name.text === methodName) {
      const argument = node.arguments[0];
      const valid = argumentKind === 'string'
        ? argument && ts.isStringLiteralLike(argument)
        : argument && ts.isIdentifier(argument);
      if (!valid) throw new Error(`${registryName}.${methodName} requires a semantic ${argumentKind} argument`);
      registrations.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return registrations;
}

function metadataRows(source, name, idProperty) {
  return objectArray(source, name).map((object) => ({
    registration: stringLiteral(property(object, 'registration', name), name),
    identity: stringLiteral(property(object, idProperty, name), name),
    vendors: arrayStrings(property(object, 'vendors', name), name),
  }));
}

function assertExactProjection(registrations, metadata, context) {
  const registered = [...registrations].sort();
  const projected = metadata.map((row) => row.registration).sort();
  if (new Set(projected).size !== projected.length) throw new Error(`Duplicate ${context} projection row`);
  if (JSON.stringify(registered) !== JSON.stringify(projected)) {
    throw new Error(`${context} registrations and semantic projection rows differ: registered=${registered.join(',')} projected=${projected.join(',')}`);
  }
}

function vendorForIdentity(identity, context) {
  const vendor = DEVICE_IDENTITY_VENDORS[identity];
  if (!vendor) throw new Error(`Unprojected ${context} identity: ${identity}`);
  return vendor;
}

function surface(kind, identity, vendor, source, capabilities, extra = {}) {
  if (!KNOWN_VENDORS.has(vendor)) throw new Error(`Unprojected ${kind} vendor: ${vendor}`);
  const unknownCapability = capabilities.find((capability) => !ALL_CAPABILITIES.includes(capability));
  if (unknownCapability) throw new Error(`Unprojected ${kind} capability: ${unknownCapability}`);
  return {
    id: `${kind}:${identity}`,
    kind,
    identity,
    vendor,
    source,
    capabilities,
    enabled: false,
    ...extra,
  };
}

function persistedDeviceSurface(readFile) {
  const schema = readFile(SOURCE_PATHS.persistedDevice);
  if (!/model Device\s*\{[\s\S]*?\btype\s+String\b/.test(schema)) {
    throw new Error('Persisted Device.type boundary is missing or no longer an open string domain');
  }
  return surface(
    'persisted-device-domain',
    'Device.type:string',
    'generic',
    SOURCE_PATHS.persistedDevice,
    ALL_CAPABILITIES,
    { openDomain: true },
  );
}

function deviceTypeSurfaces(readFile) {
  const source = parseTypeScript(SOURCE_PATHS.deviceTypes, readFile);
  return unionStrings(source, 'DeviceType')
    .filter((identity) => identity !== 'unknown')
    .map((identity) => surface(
      'device-type', identity, vendorForIdentity(identity, 'DeviceType'), SOURCE_PATHS.deviceTypes,
      ALL_CAPABILITIES,
    ));
}

function uiDeviceEnumSurfaces(readFile) {
  const source = parseTypeScript(SOURCE_PATHS.uiDeviceEnum, readFile);
  return enumValues(source, 'HardwareDevice').map((identity) => surface(
    'ui-device-enum', identity, vendorForIdentity(identity, 'HardwareDevice'), SOURCE_PATHS.uiDeviceEnum,
    ['import', 'account_add', 'display', 'sign'],
  ));
}

function catalogSurfaces(readFile) {
  const source = parseTypeScript(SOURCE_PATHS.catalog, readFile);
  return objectArray(source, 'hardwareDeviceModels').map((object) => {
    const name = stringLiteral(property(object, 'name', 'hardwareDeviceModels'), 'hardwareDeviceModels.name');
    const slug = stringLiteral(property(object, 'slug', 'hardwareDeviceModels'), 'hardwareDeviceModels.slug');
    const manufacturer = stringLiteral(property(object, 'manufacturer', 'hardwareDeviceModels'), 'hardwareDeviceModels.manufacturer');
    const vendor = MANUFACTURER_VENDORS[manufacturer];
    if (!vendor) throw new Error(`Unprojected catalog manufacturer: ${manufacturer}`);
    return surface('catalog-model', slug, vendor, SOURCE_PATHS.catalog, ALL_CAPABILITIES, { modelName: name });
  });
}

function adapterSurfaces(readFile) {
  const source = parseTypeScript(SOURCE_PATHS.adapters, readFile);
  return registeredValues(source, 'service', 'registerAdapterLoader', 'string').map((identity) => surface(
    'runtime-adapter', identity, vendorForIdentity(identity, 'adapter'), SOURCE_PATHS.adapters,
    ['account_add', 'display', 'sign'],
  ));
}

function projectedRegistrySurfaces(readFile, options) {
  const source = parseTypeScript(options.path, readFile);
  const registrations = registeredValues(source, options.registry);
  const metadata = metadataRows(source, options.metadata, options.idProperty);
  assertExactProjection(registrations, metadata, options.kind);
  return metadata.flatMap((row) => row.vendors.map((vendor) => surface(
    options.kind,
    `${row.identity}:${vendor}`,
    vendor,
    options.path,
    options.capabilities,
    { registration: row.registration, semanticIdentity: row.identity },
  )));
}

function exportHandlerSurfaces(readFile) {
  const source = parseTypeScript(SOURCE_PATHS.exportHandlers, readFile);
  return registeredValues(source, 'exportFormatRegistry').flatMap((registration) => {
    const vendors = EXPORT_HANDLER_VENDORS[registration];
    if (!vendors) throw new Error(`Unprojected export handler: ${registration}`);
    return vendors.map((vendor) => surface(
      'export-handler', `${registration}:${vendor}`, vendor, SOURCE_PATHS.exportHandlers, [],
      { access: ['view', 'export', 'recovery'], registration },
    ));
  });
}

function uiImportSurfaces(readFile) {
  const source = parseTypeScript(SOURCE_PATHS.uiImportTypes, readFile);
  return unionStrings(source, 'HardwareDeviceType').map((identity) => surface(
    'ui-hardware-import', identity, vendorForIdentity(identity, 'HardwareDeviceType'), SOURCE_PATHS.uiImportTypes,
    ['import', 'account_add'],
  ));
}

function uiSigningSurfaces(readFile) {
  const source = parseTypeScript(SOURCE_PATHS.uiSigningMethods, readFile);
  const methods = variableInitializer(source, 'SIGNING_METHODS');
  if (!ts.isObjectLiteralExpression(methods)) throw new Error('SIGNING_METHODS must be an object literal');
  return methods.properties.flatMap((entry) => {
    if (!ts.isPropertyAssignment(entry)) throw new Error('SIGNING_METHODS entries must be properties');
    const vendor = ts.isIdentifier(entry.name) || ts.isStringLiteralLike(entry.name)
      ? entry.name.text
      : null;
    if (!vendor) throw new Error('SIGNING_METHODS requires literal vendor keys');
    return arrayStrings(entry.initializer, `SIGNING_METHODS.${vendor}`).map((method) => surface(
      'ui-signing-method', `${vendor}:${method}`, vendor, SOURCE_PATHS.uiSigningMethods,
      ['sign'], { method },
    ));
  });
}

function qrAirgapCodecSurfaces(readFile) {
  const source = parseTypeScript(SOURCE_PATHS.qrAirgapCodec, readFile);
  return objectArray(source, 'QR_AIRGAP_SIGNER_SURFACES').flatMap((object) => {
    const codec = stringLiteral(property(object, 'codec', 'QR_AIRGAP_SIGNER_SURFACES'), 'codec');
    const vendor = stringLiteral(property(object, 'vendor', 'QR_AIRGAP_SIGNER_SURFACES'), 'vendor');
    return arrayStrings(property(object, 'methods', 'QR_AIRGAP_SIGNER_SURFACES'), 'methods').map((method) => surface(
      'qr-airgap-codec', `${vendor}:${codec}:${method}`, vendor, SOURCE_PATHS.qrAirgapCodec,
      ['sign', 'finalize'], { codec, method },
    ));
  });
}

function listTypeScriptFiles(path) {
  const absolute = resolve(REPOSITORY_ROOT, path);
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')))
    .map((entry) => {
      const parent = entry.parentPath ?? entry.path;
      return resolve(parent, entry.name).slice(REPOSITORY_ROOT.length + 1);
    })
    .sort();
}

const BROADCAST_EXECUTION_NAMES = new Set([
  'broadcastTransaction',
  'broadcastAndSave',
  'broadcastAuthenticatedRawTransaction',
  'broadcastValidated',
  'broadcastSignedTransaction',
  'broadcastRawNetworkTransaction',
  'broadcastReplay',
  'broadcastWithConnectedHardwareWallet',
]);

// Enforcement call sites recognised by serverCapabilityEnforcementSurfaces, mapped to the
// argument index holding the capability literal (-1 means the capability is implied).
// Hoisted to module scope so ENFORCEMENT_PREFILTER derives from the same table the AST walker
// consumes, and so the self-guard below can assert the two never drift apart.
const ENFORCEMENT_FUNCTIONS = new Map([
  ['assertHardwareWalletCapability', 1],
  ['assertWalletHardwareCapability', 1],
  ['assertWalletHardwareCapabilityById', 1],
  ['assertUnscopedRawTransactionBroadcastDisabled', -1],
]);

// Text prefilters. Both whole-tree walkers below build a full TypeScript AST (with parent
// pointers) for every file under their roots, but a surface is only ever emitted when one of
// the matched identifiers is physically present in the file text, or the file contains a
// identifier or quoted-name escape that TypeScript may normalize into a matched name. The
// funds walker accepts quoted method names, so any backslash makes it parse conservatively;
// the enforcement walker accepts only identifiers and needs only Unicode identifier escapes.
// Testing text first still skips the large majority of files that cannot match. Derived from
// the matcher tables rather than hardcoded, so adding a name to either table widens the
// prefilter with it; assertPrefiltersCoverMatchers() fails closed if that link ever breaks.
const FUNDS_EXECUTION_PREFILTER_SOURCES = Object.freeze([
  ...BROADCAST_EXECUTION_NAMES,
  'broadcast.*Signed',
  'finalize',
  'signPSBT',
  'signPsbt',
  'signWith',
  'uploadSignedPsbt',
  'processQrSignedPsbt',
]);
export const FUNDS_EXECUTION_PREFILTER = new RegExp(FUNDS_EXECUTION_PREFILTER_SOURCES.join('|'));
export const ENFORCEMENT_PREFILTER = new RegExp([...ENFORCEMENT_FUNCTIONS.keys()].join('|'));
const SOURCE_BACKSLASH_PREFILTER = /\\/;
const SOURCE_BACKSLASH_PATTERN = String.raw`\\`;
const TYPESCRIPT_IDENTIFIER_ESCAPE_PREFILTER = new RegExp(
  `${SOURCE_BACKSLASH_PATTERN}u(?:[0-9a-fA-F]{4}|[{][0-9a-fA-F]{1,6}[}])`,
);

function sourceMayMatchFundsExecution(source) {
  return FUNDS_EXECUTION_PREFILTER.test(source) || SOURCE_BACKSLASH_PREFILTER.test(source);
}

function sourceMayMatchEnforcement(source) {
  return ENFORCEMENT_PREFILTER.test(source)
    || TYPESCRIPT_IDENTIFIER_ESCAPE_PREFILTER.test(source);
}

// Names the funds matcher must recognise: every broadcast literal, plus one representative per
// pattern branch in executionCapability(), plus the two property-access operations the walker
// matches directly rather than through executionCapability().
const FUNDS_MATCHER_WITNESSES = Object.freeze([
  ...BROADCAST_EXECUTION_NAMES,
  'broadcastRelaySigned',
  'broadcast$Signed',
  'finalize',
  'finalizeInput',
  'finalizeAllInputs',
  'signPSBT',
  'signPsbt',
  'signWithDevice',
  'uploadSignedPsbt',
  'processQrSignedPsbt',
]);

// Reports matcher/prefilter gaps; empty means the prefilters are wide enough. The regexes are
// injectable so tests can exercise the reporting path with a deliberately narrow prefilter
// instead of having to break the real configuration.
export function collectPrefilterGaps({
  fundsPrefilter = FUNDS_EXECUTION_PREFILTER,
  enforcementPrefilter = ENFORCEMENT_PREFILTER,
  witnesses = FUNDS_MATCHER_WITNESSES,
} = {}) {
  const gaps = [];
  for (const name of witnesses) {
    // Every witness must stay recognised: the two property-access operations are matched
    // directly by the walker, but executionCapability() also accepts them via its `finalize`
    // prefix branch, so no name here is exempt from the recognition assertion.
    if (executionCapability(name) === null) {
      gaps.push(`executionCapability no longer recognises "${name}"`);
    } else if (!fundsPrefilter.test(name)) {
      gaps.push(`funds prefilter does not match "${name}"`);
    }
  }
  for (const name of ENFORCEMENT_FUNCTIONS.keys()) {
    if (!enforcementPrefilter.test(name)) {
      gaps.push(`enforcement prefilter does not match "${name}"`);
    }
  }
  return gaps;
}

// Fails closed when a matcher gains a name its prefilter cannot see. Without this, widening
// executionCapability() or ENFORCEMENT_FUNCTIONS would silently narrow the scan instead of
// widening it, and the inventory would lose surfaces. Note this only covers the witnesses
// above; the stronger guarantee is the prefilter-is-a-no-op test, which compares a filtered
// scan against an unfiltered one and therefore catches novel matcher branches too.
export function assertPrefiltersCoverMatchers(overrides) {
  const gaps = collectPrefilterGaps(overrides);
  if (gaps.length > 0) {
    throw new Error(`signer inventory prefilters are narrower than their matchers:\n- ${gaps.join('\n- ')}`);
  }
}

function executionCapability(name) {
  if (BROADCAST_EXECUTION_NAMES.has(name) || /^broadcast.*Signed/.test(name)) return 'broadcast';
  if (name.startsWith('finalize')) return 'finalize';
  if (/^(?:signPSBT|signPsbt|signWith)/.test(name)) return 'sign';
  if (name === 'uploadSignedPsbt' || name === 'processQrSignedPsbt') return 'sign';
  return null;
}

function callableDeclarationName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.body && node.name) {
    return ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : null;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    return node.name.text;
  }
  return null;
}

function executionVendor(path) {
  const match = path.match(/src\/services\/hardwareWallet\/adapters\/([^/]+)\//);
  return match && KNOWN_VENDORS.has(match[1]) ? match[1] : 'generic';
}

function fundsExecutionPointSurfaces(readFile, prefilter = true) {
  const sourcePaths = new Set([
    ...listTypeScriptFiles(SOURCE_PATHS.clientFundsExecution),
    ...listTypeScriptFiles(SOURCE_PATHS.serverBitcoinExecution),
    ...listTypeScriptFiles(SOURCE_PATHS.serverTransactionEntryPoints),
  ]);
  const points = [];
  for (const path of [...sourcePaths].sort()) {
    // Must read through the injected `readFile`, not the repository reader: the drift tests
    // overlay a mutated source for exactly one path, and prefiltering the on-disk text would
    // skip the file they mutated.
    if (prefilter && !sourceMayMatchFundsExecution(readFile(path))) continue;
    const source = parseTypeScript(path, readFile);
    const counts = new Map();
    const addPoint = (name, capability, kind) => {
      const countKey = `${name}\0${capability}\0${kind}`;
      const ordinal = (counts.get(countKey) ?? 0) + 1;
      counts.set(countKey, ordinal);
      points.push(surface(
        'funds-execution-point',
        `${path}:${name}:${kind}:${ordinal}`,
        executionVendor(path),
        path,
        [capability],
        { executionName: name, executionKind: kind },
      ));
    };
    const visit = (node) => {
      const callableName = callableDeclarationName(node);
      if (callableName) {
        const capability = executionCapability(callableName);
        if (capability) addPoint(callableName, capability, 'callable');
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const operationName = node.expression.name.text;
        if (operationName === 'finalizeAllInputs' || operationName === 'finalizeInput') {
          addPoint(operationName, 'finalize', 'operation');
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const discoveredCounts = new Map();
  for (const row of points) {
    const key = [row.source, row.executionName, row.capabilities[0], row.executionKind].join('\0');
    discoveredCounts.set(key, (discoveredCounts.get(key) ?? 0) + 1);
  }
  const discoveredProjection = [...discoveredCounts.entries()]
    .map(([key, count]) => [...key.split('\0'), count])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const requiredProjection = REQUIRED_FUNDS_EXECUTION_POINTS
    .map((row) => [...row])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (JSON.stringify(discoveredProjection) !== JSON.stringify(requiredProjection)) {
    throw new Error(
      `Funds execution points drifted: required=${JSON.stringify(requiredProjection)} discovered=${JSON.stringify(discoveredProjection)}`,
    );
  }
  return points;
}

function serverCapabilityEnforcementSurfaces(readFile, prefilter = true) {
  const servicePath = 'server/src/services/hardwareWalletCapabilities.ts';
  const enforcementFunctions = ENFORCEMENT_FUNCTIONS;
  const surfaces = [];
  for (const path of listTypeScriptFiles(SOURCE_PATHS.serverCapabilityEnforcement)) {
    if (path === servicePath) continue;
    // See the note in fundsExecutionPointSurfaces: prefilter through the injected reader.
    if (prefilter && !sourceMayMatchEnforcement(readFile(path))) continue;
    const source = parseTypeScript(path, readFile);
    const counts = new Map();
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const argumentIndex = enforcementFunctions.get(node.expression.text);
        if (argumentIndex !== undefined) {
          const capability = argumentIndex === -1
            ? 'broadcast'
            : stringLiteral(node.arguments[argumentIndex], `${node.expression.text} capability in ${path}`);
          const countKey = `${node.expression.text}:${capability}`;
          const ordinal = (counts.get(countKey) ?? 0) + 1;
          counts.set(countKey, ordinal);
          surfaces.push(surface(
            'server-capability-enforcement',
            `${path}:${node.expression.text}:${capability}:${ordinal}`,
            'generic',
            path,
            [capability],
            { enforcementFunction: node.expression.text },
          ));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (surfaces.length === 0) throw new Error('No server capability enforcement call sites found');
  const discoveredCounts = new Map();
  for (const row of surfaces) {
    const key = `${row.source}\0${row.enforcementFunction}\0${row.capabilities[0]}`;
    discoveredCounts.set(key, (discoveredCounts.get(key) ?? 0) + 1);
  }
  const discoveredProjection = [...discoveredCounts.entries()]
    .map(([key, count]) => [...key.split('\0'), count])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const requiredProjection = REQUIRED_SERVER_CAPABILITY_BOUNDARIES
    .map((row) => [...row])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (JSON.stringify(discoveredProjection) !== JSON.stringify(requiredProjection)) {
    throw new Error(
      `Server capability enforcement boundaries drifted: required=${JSON.stringify(requiredProjection)} discovered=${JSON.stringify(discoveredProjection)}`,
    );
  }
  return surfaces;
}

function runtimeCapabilityManifest(readFile) {
  const source = parseTypeScript(SOURCE_PATHS.capabilityManifest, readFile);
  const vendors = arrayStrings(
    variableInitializer(source, 'HARDWARE_WALLET_VENDORS'),
    'HARDWARE_WALLET_VENDORS',
  );
  const capabilities = arrayStrings(
    variableInitializer(source, 'HARDWARE_WALLET_CAPABILITIES'),
    'HARDWARE_WALLET_CAPABILITIES',
  );
  const implementations = [];
  const inventory = variableInitializer(source, 'HARDWARE_WALLET_IMPLEMENTATION_INVENTORY');
  const visit = (node) => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'implementationInventoryRow') {
      implementations.push({
        vendor: stringLiteral(node.arguments[0], 'implementationInventoryRow vendor'),
        aliases: arrayStrings(node.arguments[1], 'implementationInventoryRow aliases'),
        catalogModelSlugs: arrayStrings(node.arguments[2], 'implementationInventoryRow catalog slugs'),
        catalogModelNames: arrayStrings(node.arguments[3], 'implementationInventoryRow catalog names'),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(inventory);

  const sortedVendors = [...vendors].sort();
  const implementationVendors = implementations.map((row) => row.vendor).sort();
  if (JSON.stringify(sortedVendors) !== JSON.stringify(implementationVendors)) {
    throw new Error('Capability manifest vendors and implementation inventory differ');
  }
  if (JSON.stringify(sortedVendors) !== JSON.stringify([...KNOWN_VENDORS].sort())) {
    throw new Error('Capability manifest vendor domain drifted without generator review');
  }
  if (JSON.stringify(capabilities) !== JSON.stringify(ALL_CAPABILITIES)) {
    throw new Error('Capability manifest capability domain drifted without generator review');
  }
  for (const row of implementations) {
    if (row.catalogModelSlugs.length !== row.catalogModelNames.length) {
      throw new Error(`Capability inventory model slug/name mismatch for ${row.vendor}`);
    }
  }

  const capabilityRows = implementations.flatMap((implementation) =>
    [...implementation.catalogModelSlugs, `${implementation.vendor}-unresolved`].flatMap((modelFamily) =>
      capabilities.map((capability) => ({
        id: `${implementation.vendor}.${modelFamily}.${capability}`,
        vendor: implementation.vendor,
        modelFamily,
        capability,
        enabled: false,
      })),
    ));
  return { vendors, capabilities, implementations, capabilityRows };
}

function assertCatalogMatchesCapabilityInventory(surfaces, manifest) {
  const catalogProjection = surfaces
    .filter((row) => row.kind === 'catalog-model')
    .map((row) => `${row.vendor}:${row.identity}:${row.modelName}`)
    .sort();
  const runtimeProjection = manifest.implementations
    .flatMap((row) => row.catalogModelSlugs.map((slug, index) =>
      `${row.vendor}:${slug}:${row.catalogModelNames[index]}`))
    .sort();
  if (JSON.stringify(catalogProjection) !== JSON.stringify(runtimeProjection)) {
    throw new Error('Catalog models and runtime capability implementation inventory differ');
  }
}

function bindCapabilityRows(surfaces, manifest) {
  const rowIds = new Set(manifest.capabilityRows.map((row) => row.id));
  return surfaces.map((row) => {
    if (!manifest.vendors.includes(row.vendor)) {
      throw new Error(`Signer surface has no runtime capability implementation: ${row.id}`);
    }
    const implementation = manifest.implementations.find(
      (candidate) => candidate.vendor === row.vendor,
    );
    const unresolvedModelFamily = `${row.vendor}-unresolved`;
    const modelFamilies = row.kind === 'catalog-model'
      ? [row.identity]
      : row.kind === 'ui-signing-method'
        ? [...implementation.catalogModelSlugs, unresolvedModelFamily]
        : [unresolvedModelFamily];
    const capabilityRowIds = modelFamilies.flatMap((modelFamily) =>
      row.capabilities.map((capability) => `${row.vendor}.${modelFamily}.${capability}`));
    const missing = capabilityRowIds.find((id) => !rowIds.has(id));
    if (missing) throw new Error(`Signer surface has no runtime capability row: ${row.id} -> ${missing}`);
    if (row.kind === 'ui-signing-method') {
      return {
        ...row,
        capabilityProjection: 'runtime-exact-model-with-unresolved-denial',
        exactModelCapabilityRowIds: capabilityRowIds.filter(
          (id) => !id.includes(`.${unresolvedModelFamily}.`),
        ),
        unresolvedDenialCapabilityRowId: `${row.vendor}.${unresolvedModelFamily}.sign`,
        capabilityRowIds,
      };
    }
    return { ...row, capabilityRowIds };
  });
}

// `prefilter: false` runs both whole-tree walkers without their text prefilters. It exists so
// tests can assert the prefiltered scan is a pure no-op on the emitted surfaces; production
// callers should never pass it.
export function buildSignerInventory(readFile = readRepositoryFile, { prefilter = true } = {}) {
  const manifest = runtimeCapabilityManifest(readFile);
  const discoveredSurfaces = [
    persistedDeviceSurface(readFile),
    ...deviceTypeSurfaces(readFile),
    ...uiDeviceEnumSurfaces(readFile),
    ...catalogSurfaces(readFile),
    ...adapterSurfaces(readFile),
    ...projectedRegistrySurfaces(readFile, {
      path: SOURCE_PATHS.parsers,
      registry: 'deviceParserRegistry',
      metadata: 'DEVICE_PARSER_SIGNER_SURFACES',
      idProperty: 'parserId',
      kind: 'device-parser',
      capabilities: ['import', 'account_add'],
    }),
    ...projectedRegistrySurfaces(readFile, {
      path: SOURCE_PATHS.importHandlers,
      registry: 'importFormatRegistry',
      metadata: 'IMPORT_HANDLER_SIGNER_SURFACES',
      idProperty: 'handlerId',
      kind: 'import-handler',
      capabilities: ['import', 'account_add'],
    }),
    ...exportHandlerSurfaces(readFile),
    ...uiImportSurfaces(readFile),
    ...uiSigningSurfaces(readFile),
    ...qrAirgapCodecSurfaces(readFile),
    ...serverCapabilityEnforcementSurfaces(readFile, prefilter),
    ...fundsExecutionPointSurfaces(readFile, prefilter),
  ].sort((left, right) => left.id.localeCompare(right.id));

  assertCatalogMatchesCapabilityInventory(discoveredSurfaces, manifest);
  const surfaces = bindCapabilityRows(discoveredSurfaces, manifest);

  const duplicateIds = surfaces.filter((row, index) =>
    surfaces.findIndex((candidate) => candidate.id === row.id) !== index);
  if (duplicateIds.length > 0) throw new Error(`Duplicate signer inventory IDs: ${duplicateIds.map((row) => row.id).join(', ')}`);

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/generate-signer-inventory.mjs',
    contract: 'Every signer surface is explicit and disabled until an exact evidence-backed capability row enables it.',
    sources: Object.values(SOURCE_PATHS).sort(),
    requiredServerCapabilityBoundaries: REQUIRED_SERVER_CAPABILITY_BOUNDARIES.map(
      ([source, assertion, capability, count]) => ({ source, assertion, capability, count }),
    ),
    requiredFundsExecutionPoints: REQUIRED_FUNDS_EXECUTION_POINTS.map(
      ([source, name, capability, kind, count]) => ({ source, name, capability, kind, count }),
    ),
    capabilityRows: manifest.capabilityRows,
    surfaces,
  };
}

export const renderSignerInventory = (inventory) => `${JSON.stringify(inventory, null, 2)}\n`;

export function checkSignerInventory(readFile = readRepositoryFile) {
  const expected = renderSignerInventory(buildSignerInventory(readFile));
  const actual = readFile(OUTPUT_PATH);
  if (actual !== expected) {
    throw new Error(`Signer inventory projection is stale. Run: npm run generate:signer-inventory`);
  }
  return expected;
}

function main() {
  if (process.argv.includes('--check')) {
    checkSignerInventory();
    process.stdout.write('Signer inventory projection is current.\n');
    return;
  }
  const output = renderSignerInventory(buildSignerInventory());
  writeFileSync(resolve(REPOSITORY_ROOT, OUTPUT_PATH), output);
  process.stdout.write(`Generated ${OUTPUT_PATH}.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
