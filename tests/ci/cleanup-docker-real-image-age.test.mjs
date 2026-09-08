import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../ownership/cleanup-docker-real.test.mjs', import.meta.url), 'utf8');

test('real Docker cleanup fixture stamps and verifies both run-built images as current', () => {
  assert.match(source, /const fixtureImageCreatedEpoch = Math\.floor\(Date\.now\(\) \/ 1000\);/);
  assert.equal(
    [...source.matchAll(/SOURCE_DATE_EPOCH: String\(fixtureImageCreatedEpoch\)/g)].length,
    2,
  );
  assert.equal(
    [...source.matchAll(/assertImageCreationEpoch\(inContext, [^,]+, fixtureImageCreatedEpoch\);/g)].length,
    2,
  );
});
