#!/usr/bin/env node
// B9: ESM-from-CJS interop probe.
// Verifies that named exports from @sanctuary/shared (CJS dist) are usable
// from a .mjs (ESM) script. Catches a regression where CJS emit produces
// patterns that Node's cjs-module-lexer can't synthesize named exports from.
//
// Run from repo root: node scripts/probe-shared-esm.mjs

import assert from 'node:assert/strict';

// 1. Subpath import (most common consumer pattern)
import { extractErrorMessage as fromSubpath } from '@sanctuary/shared/utils/errors';
assert.equal(typeof fromSubpath, 'function', 'subpath named export must be a function');
assert.equal(fromSubpath(new Error('probe')), 'probe', 'subpath import behaves correctly');

// 2. Bare import via index.ts barrel (the `.` exports root entry)
import { extractErrorMessage as fromBare } from '@sanctuary/shared';
assert.equal(typeof fromBare, 'function', 'bare-import named export must be a function');
assert.equal(fromBare(new Error('probe')), 'probe', 'bare import behaves correctly');

console.log('B9 OK: ESM .mjs can import named exports from @sanctuary/shared (subpath + bare)');
