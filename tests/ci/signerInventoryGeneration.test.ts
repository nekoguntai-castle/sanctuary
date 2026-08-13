import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HARDWARE_WALLET_CAPABILITY_ROWS,
  HARDWARE_WALLET_IMPLEMENTATION_INVENTORY,
} from '../../shared/constants/hardwareWalletCapabilities';

import {
  buildSignerInventory,
  checkSignerInventory,
  OUTPUT_PATH,
  SOURCE_PATHS,
} from '../../scripts/generate-signer-inventory.mjs';

const readRepositoryFile = (path: string): string => readFileSync(resolve(path), 'utf8');

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

describe('generated signer implementation inventory', { timeout: 20_000 }, () => {
  it('matches the checked-in deterministic projection', () => {
    expect(() => checkSignerInventory(readRepositoryFile)).not.toThrow();
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
