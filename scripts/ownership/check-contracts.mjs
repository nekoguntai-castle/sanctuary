#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseStrictJson } from './canonical-json.mjs';
import { scanLifecycleCallsites, validateLifecycleCallsites } from './check-lifecycle-callsites.mjs';
import { loadAndValidateContracts, validateApplicationAuthorities } from './contracts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ownershipPath = path.resolve(process.argv[2] ?? path.join(root, 'config/resource-ownership-contract.json'));
const callsitesPath = path.resolve(process.argv[3] ?? path.join(root, 'config/resource-lifecycle-callsites.json'));

loadAndValidateContracts(ownershipPath, callsitesPath);
validateApplicationAuthorities(parseStrictJson(readFileSync(path.join(root, 'config/application-lifecycle-authorities.json'))));
const callsiteInventory = parseStrictJson(readFileSync(callsitesPath));
const lifecycle = validateLifecycleCallsites({
  inventory: callsiteInventory,
  scan: scanLifecycleCallsites({ root }),
  phase: 5,
});
console.log(`resource ownership contract and lifecycle inventory are valid (${lifecycle.callsites} Docker lifecycle identities)`);
