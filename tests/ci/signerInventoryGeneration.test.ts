import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HARDWARE_WALLET_CAPABILITY_ROWS,
  HARDWARE_WALLET_IMPLEMENTATION_INVENTORY,
} from '../../shared/constants/hardwareWalletCapabilities';

import {
  assertPrefiltersCoverMatchers,
  buildSignerInventory,
  checkSignerInventory,
  collectPrefilterGaps,
  ENFORCEMENT_PREFILTER,
  FUNDS_EXECUTION_PREFILTER,
  OUTPUT_PATH,
  SOURCE_PATHS,
} from '../../scripts/generate-signer-inventory.mjs';

const readRepositoryFile = (path: string): string => readFileSync(resolve(path), 'utf8');
const SOURCE_BACKSLASH = '\\';

interface GeneratedCapabilityRow {
  id: string;
  vendor: string;
  modelFamily: string;
  capability: string;
  enabled: boolean;
}

interface GeneratedSurface {
  id: string;
  kind: string;
  identity: string;
  vendor: string;
  modelName?: string;
  source: string;
  capabilities: string[];
  enabled: boolean;
  capabilityRowIds: string[];
  capabilityProjection?: string;
  exactModelCapabilityRowIds?: string[];
  unresolvedDenialCapabilityRowId?: string;
  executionName?: string;
  executionKind?: string;
}

interface GeneratedInventory {
  capabilityRows: GeneratedCapabilityRow[];
  surfaces: GeneratedSurface[];
}

const generateInventory = (): GeneratedInventory =>
  buildSignerInventory(readRepositoryFile) as GeneratedInventory;

function overlayReader(path: string, transform: (source: string) => string) {
  return (requestedPath: string): string => {
    const source = readRepositoryFile(requestedPath);
    return requestedPath === path ? transform(source) : source;
  };
}

function inventoryFailure(readFile: (path: string) => string, prefilter: boolean): string {
  try {
    buildSignerInventory(readFile, { prefilter });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Expected the ${prefilter ? 'filtered' : 'unfiltered'} scan to reject drift`);
}

describe('generated signer implementation inventory', { timeout: 20_000 }, () => {
  it('matches the checked-in deterministic projection', () => {
    expect(() => checkSignerInventory(readRepositoryFile)).not.toThrow();
  });

  // The walkers skip parsing any file whose text misses these prefilters. This is the load-
  // bearing guarantee: run both scans with the prefilters disabled and require the emitted
  // surfaces to be identical. Unlike a witness list, this catches a *new* matcher branch too —
  // the unfiltered scan would find the surface the filtered scan skipped.
  it('emits identical surfaces with the scan prefilters disabled', () => {
    const filtered = buildSignerInventory(readRepositoryFile) as GeneratedInventory;
    const unfiltered = buildSignerInventory(readRepositoryFile, {
      prefilter: false,
    }) as GeneratedInventory;
    expect(unfiltered).toEqual(filtered);
  });

  it('keeps both scan prefilters at least as wide as the matchers they guard', () => {
    expect(collectPrefilterGaps()).toEqual([]);
    expect(() => assertPrefiltersCoverMatchers()).not.toThrow();
  });

  it.each([
    ['identifier punctuation', 'export function broadcast$Signed(): void {}'],
    ['escaped suffix', `export function broadcast${SOURCE_BACKSLASH}u0053igned(): void {}`],
    ['escaped prefix', `export function ${SOURCE_BACKSLASH}u0062roadcastSigned(): void {}`],
    ['hex-escaped quoted method',
      `class EscapedName { '${SOURCE_BACKSLASH}x62roadcastSigned'(): void {} }`],
    ['non-escape-character quoted method',
      `class EscapedName { 'br${SOURCE_BACKSLASH}oadcastSigned'(): void {} }`],
    ['quoted-method line continuation',
      `class EscapedName { 'broad${SOURCE_BACKSLASH}\ncastSigned'(): void {} }`],
  ])('does not let %s bypass the funds-execution prefilter', (_case, declaration) => {
    const reader = overlayReader('src/App.tsx', (source) => `${source}\n${declaration}\n`);
    const unfilteredFailure = inventoryFailure(reader, false);
    expect(unfilteredFailure).toContain('Funds execution points drifted');
    expect(inventoryFailure(reader, true)).toBe(unfilteredFailure);
  });

  it('does not let escaped identifiers bypass the enforcement prefilter', () => {
    const reader = overlayReader('server/src/utils/errors.ts', (source) =>
      `${source}\n${SOURCE_BACKSLASH}u0061ssertWalletHardwareCapabilityById('wallet', 'broadcast');\n`);
    const unfilteredFailure = inventoryFailure(reader, false);
    expect(unfilteredFailure).toContain('Server capability enforcement boundaries drifted');
    expect(inventoryFailure(reader, true)).toBe(unfilteredFailure);
  });

  // A prefilter that matched everything would keep every other assertion green while silently
  // restoring the whole-tree parse this change exists to avoid, so pin that it stays selective.
  it('keeps both scan prefilters selective rather than degenerately broad', () => {
    for (const noise of ['unrelatedHelperName', 'renderDashboardCard', '// plain comment']) {
      expect(FUNDS_EXECUTION_PREFILTER.test(noise)).toBe(false);
      expect(ENFORCEMENT_PREFILTER.test(noise)).toBe(false);
    }
  });

  it('reports and throws when a prefilter is narrower than its matcher', () => {
    // Exercise the reporting and failure paths without breaking the real configuration.
    const narrowed = { fundsPrefilter: /broadcastTransaction/ };
    const gaps = collectPrefilterGaps(narrowed);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some((gap) => gap.includes('funds prefilter does not match'))).toBe(true);
    expect(() => assertPrefiltersCoverMatchers(narrowed))
      .toThrow(/prefilters are narrower than their matchers/);

    const narrowedEnforcement = { enforcementPrefilter: /assertHardwareWalletCapability$/ };
    expect(collectPrefilterGaps(narrowedEnforcement)
      .some((gap) => gap.includes('enforcement prefilter does not match'))).toBe(true);

    // The other reporting branch: a witness the matcher itself no longer recognises.
    expect(collectPrefilterGaps({ witnesses: ['notARecognisedExecutionName'] }))
      .toEqual(['executionCapability no longer recognises "notARecognisedExecutionName"']);
  });

  it('keeps every discovered surface disabled and identifies the open persisted domain', () => {
    const inventory = generateInventory();

    expect(inventory.surfaces).not.toEqual([]);
    expect(inventory.surfaces.every((row) => row.enabled === false)).toBe(true);
    expect(inventory.surfaces).toContainEqual(expect.objectContaining({
      id: 'persisted-device-domain:Device.type:string',
      openDomain: true,
      vendor: 'generic',
    }));
    expect(new Set(inventory.surfaces.map((row) => row.id)).size).toBe(inventory.surfaces.length);
  });

  it('exactly matches runtime implementation and capability rows', () => {
    const inventory = generateInventory();
    const generatedRows = inventory.capabilityRows.map((row) => ({
      id: row.id,
      vendor: row.vendor,
      modelFamily: row.modelFamily,
      capability: row.capability,
      enabled: row.enabled,
    }));
    const runtimeRows = HARDWARE_WALLET_CAPABILITY_ROWS.map((row) => ({
      id: row.id,
      vendor: row.vendor,
      modelFamily: row.modelFamily,
      capability: row.capability,
      enabled: row.enabled,
    }));

    expect(generatedRows).toEqual(runtimeRows);
    expect(inventory.capabilityRows).not.toEqual([]);
    expect(inventory.capabilityRows.every((row) => row.enabled === false)).toBe(true);
    expect(inventory.surfaces.every((surface) =>
      surface.capabilityRowIds.every((id) => inventory.capabilityRows.some((row) => row.id === id))))
      .toBe(true);

    const runtimeModels = HARDWARE_WALLET_IMPLEMENTATION_INVENTORY.flatMap((row) =>
      row.catalogModelSlugs.map((slug, index) => `${row.vendor}:${slug}:${row.catalogModelNames[index]}`))
      .sort();
    const generatedModels = inventory.surfaces
      .filter((row) => row.kind === 'catalog-model')
      .map((row) => `${row.vendor}:${row.identity}:${row.modelName}`)
      .sort();
    expect(generatedModels).toEqual(runtimeModels);
  });

  it('rejects a new adapter or device enum identity without a projection', () => {
    const adapterReader = overlayReader(SOURCE_PATHS.adapters, (source) => `${source}\nservice.registerAdapterLoader('future-signer', async () => { throw new Error('disabled'); });\n`);
    expect(() => buildSignerInventory(adapterReader)).toThrow('Unprojected adapter identity');

    const enumReader = overlayReader(SOURCE_PATHS.uiDeviceEnum, (source) =>
      source.replace("  GENERIC = 'Generic SD',", "  GENERIC = 'Generic SD',\n  FUTURE = 'Future Signer',"));
    expect(() => buildSignerInventory(enumReader)).toThrow('Unprojected HardwareDevice identity');
  });

  it('rejects parser and import registrations without semantic metadata', () => {
    const parserReader = overlayReader(SOURCE_PATHS.parsers, (source) =>
      source.replace(
        'deviceParserRegistry.register(descriptorJsonParser);',
        'deviceParserRegistry.register(descriptorJsonParser);\ndeviceParserRegistry.register(futureParser);',
      ));
    expect(() => buildSignerInventory(parserReader)).toThrow('device-parser registrations and semantic projection rows differ');

    const importReader = overlayReader(SOURCE_PATHS.importHandlers, (source) =>
      source.replace(
        'importFormatRegistry.register(coldcardHandler);',
        'importFormatRegistry.register(coldcardHandler);\nimportFormatRegistry.register(futureHandler);',
      ));
    expect(() => buildSignerInventory(importReader)).toThrow('import-handler registrations and semantic projection rows differ');
  });

  it('rejects a UI signing method without a known signer projection', () => {
    const reader = overlayReader(SOURCE_PATHS.uiSigningMethods, (source) =>
      source.replace("  trezor: ['usb'],", "  trezor: ['usb'],\n  future: ['usb'],"));
    expect(() => buildSignerInventory(reader)).toThrow('Unprojected ui-signing-method vendor');
  });

  it('projects UI transports across exact model rows and explicit unresolved denial', () => {
    const inventory = generateInventory();
    const ledgerUsb = inventory.surfaces.find(
      (row) => row.id === 'ui-signing-method:ledger:usb',
    );

    expect(ledgerUsb).toMatchObject({
      capabilityProjection: 'runtime-exact-model-with-unresolved-denial',
      exactModelCapabilityRowIds: [
        'ledger.ledger-nano-s-plus.sign',
        'ledger.ledger-nano-x.sign',
        'ledger.ledger-stax.sign',
        'ledger.ledger-flex.sign',
        'ledger.ledger-gen-5.sign',
      ],
      unresolvedDenialCapabilityRowId: 'ledger.ledger-unresolved.sign',
    });
    if (!ledgerUsb) throw new Error('Ledger USB signing surface is missing');
    expect(ledgerUsb.capabilityRowIds).toEqual([
      ...(ledgerUsb.exactModelCapabilityRowIds ?? []),
      ledgerUsb.unresolvedDenialCapabilityRowId,
    ]);
    expect(ledgerUsb.capabilityRowIds.every((id) =>
      inventory.capabilityRows.some((row) => row.id === id && row.enabled === false)))
      .toBe(true);

    for (const surface of inventory.surfaces.filter((row) => row.kind === 'ui-signing-method')) {
      const runtimeModels = HARDWARE_WALLET_IMPLEMENTATION_INVENTORY.find(
        (row) => row.vendor === surface.vendor,
      )?.catalogModelSlugs ?? [];
      expect(surface.exactModelCapabilityRowIds).toEqual(
        runtimeModels.map((model) => `${surface.vendor}.${model}.sign`),
      );
      expect(surface.unresolvedDenialCapabilityRowId)
        .toBe(`${surface.vendor}.${surface.vendor}-unresolved.sign`);
    }
  });

  it('inventories QR codecs and every semantic server capability enforcement call', () => {
    const inventory = generateInventory();
    expect(inventory.surfaces).toContainEqual(expect.objectContaining({
      id: 'qr-airgap-codec:passport:crypto-psbt:qr',
      capabilities: ['sign', 'finalize'],
    }));
    expect(inventory.surfaces).toContainEqual(expect.objectContaining({
      kind: 'server-capability-enforcement',
      source: 'server/src/services/bitcoin/transactions/broadcasting.ts',
      capabilities: ['broadcast'],
    }));
    expect(inventory.surfaces.filter((row) => row.kind === 'server-capability-enforcement').length)
      .toBeGreaterThan(20);
  });

  it('rejects deletion of the production broadcast assertion before regeneration', () => {
    const broadcastPath = 'server/src/services/bitcoin/transactions/broadcasting.ts';
    const reader = overlayReader(broadcastPath, (source) => source.replace(
      "  await assertWalletHardwareCapabilityById(walletId, 'broadcast');\n",
      '',
    ));

    expect(() => buildSignerInventory(reader)).toThrow(
      'Server capability enforcement boundaries drifted',
    );
  });

  it('inventories concrete sign, finalize, broadcast, and client entry implementations', () => {
    const executionPoints = generateInventory().surfaces.filter(
      (row) => row.kind === 'funds-execution-point',
    );

    expect(executionPoints).toContainEqual(expect.objectContaining({
      source: 'src/services/hardwareWallet/adapters/bitbox/signPsbt.ts',
      executionName: 'signPsbtWithBitBox',
      capabilities: ['sign'],
    }));
    expect(executionPoints).toContainEqual(expect.objectContaining({
      source: 'src/services/hardwareWallet/adapters/ledger/signPsbt.ts',
      executionName: 'finalizeAllInputs',
      executionKind: 'operation',
      capabilities: ['finalize'],
    }));
    expect(executionPoints).toContainEqual(expect.objectContaining({
      source: 'server/src/services/bitcoin/transactions/broadcasting.ts',
      executionName: 'broadcastAndSave',
      capabilities: ['broadcast'],
    }));
    expect(executionPoints).toContainEqual(expect.objectContaining({
      source: 'src/hooks/send/useBroadcast.ts',
      executionName: 'broadcastTransaction',
      capabilities: ['broadcast'],
    }));
  });

  it('rejects a new unreviewed signing implementation before regeneration', () => {
    const path = 'src/services/hardwareWallet/adapters/ledger/signPsbt.ts';
    const reader = overlayReader(path, (source) =>
      `${source}\nexport async function signPsbtWithFutureDevice(): Promise<void> {}\n`);
    expect(() => buildSignerInventory(reader)).toThrow('Funds execution points drifted');
  });

  it('rejects a new unreviewed TSX signing entry point before regeneration', () => {
    const path = 'src/components/send/SendTransactionWizard/WizardStepContent.tsx';
    const reader = overlayReader(path, (source) =>
      `${source}\nconst signWithUnreviewedSigner = async (): Promise<void> => {};\n`);
    expect(() => buildSignerInventory(reader)).toThrow('Funds execution points drifted');
  });

  it('rejects deletion of an actual signing implementation before regeneration', () => {
    const path = 'src/services/hardwareWallet/adapters/bitbox/signPsbt.ts';
    const reader = overlayReader(path, () => '');
    expect(() => buildSignerInventory(reader)).toThrow('Funds execution points drifted');
  });

  it('fails the check when a known source changes without regeneration', () => {
    const reader = (path: string): string => path === OUTPUT_PATH
      ? readRepositoryFile(path)
      : overlayReader(SOURCE_PATHS.uiImportTypes, (source) => source.replace(
          "'ledger' | 'trezor' | 'jade'",
          "'ledger' | 'trezor' | 'jade' | 'bitbox'",
        ))(path);
    expect(() => checkSignerInventory(reader)).toThrow('Signer inventory projection is stale');
  });

  it('rejects runtime manifest addition and deletion drift', () => {
    const addModel = overlayReader(SOURCE_PATHS.capabilityManifest, (source) => source.replace(
      '["bitbox02", "bitbox02-btc-only"]',
      '["bitbox02", "bitbox02-btc-only", "bitbox-future"]',
    ).replace(
      '["BitBox02", "BitBox02 Bitcoin-only"]',
      '["BitBox02", "BitBox02 Bitcoin-only", "BitBox Future"]',
    ));
    expect(() => buildSignerInventory(addModel)).toThrow(
      'Catalog models and runtime capability implementation inventory differ',
    );

    const deleteVendor = overlayReader(SOURCE_PATHS.capabilityManifest, (source) => source.replace(
      '  implementationInventoryRow("seedsigner", ["seedsigner"], ["seedsigner"], ["SeedSigner"]),\n',
      '',
    ));
    expect(() => buildSignerInventory(deleteVendor)).toThrow(
      'Capability manifest vendors and implementation inventory differ',
    );
  });

  it('rejects deletion of a generated surface even when the JSON stays valid', () => {
    const reader = (path: string): string => {
      if (path !== OUTPUT_PATH) return readRepositoryFile(path);
      const output = JSON.parse(readRepositoryFile(path)) as { surfaces: unknown[] };
      output.surfaces.splice(0, 1);
      return `${JSON.stringify(output, null, 2)}\n`;
    };
    expect(() => checkSignerInventory(reader)).toThrow('Signer inventory projection is stale');
  });
});
