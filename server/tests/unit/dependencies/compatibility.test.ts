import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);

// Exercise callers of root overrides, rather than checking package versions only.
test('PostCSS can synchronously load nanoid and assign distinct input identities', () => {
  const postcss = require('postcss');
  const ids = new Set(Array.from({ length: 100 }, () => postcss.parse('a { color: red }').source.input.id));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^<input css .{6}>$/);
});

test('StellarToml resolves and parses a local stellar.toml through TOML', async () => {
  const { StellarToml } = require('@stellar/stellar-sdk');
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/.well-known/stellar.toml');
    response.setHeader('content-type', 'text/plain');
    response.end('VERSION = "2.0"\nNETWORK_PASSPHRASE = "Test SDF Network ; September 2015"\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const { port } = address;
    const result = await StellarToml.Resolver.resolve(`127.0.0.1:${port}`, { allowHttp: true });
    assert.equal(result.VERSION, '2.0');
    assert.equal(result.NETWORK_PASSPHRASE, 'Test SDF Network ; September 2015');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Trezor protobuf messages round-trip and reject truncated wire data', () => {
  const protobuf = require('@trezor/protobuf');
  const root = protobuf.parseConfigure(require('@trezor/protobuf/messages.json'));
  const encoded = protobuf.encodeMessage(root, 'Ping', { message: 'roundtrip' });
  assert.deepEqual(protobuf.decodeMessage(root, encoded.messageType, encoded.message), {
    type: 'Ping',
    message: { message: 'roundtrip', button_protection: null },
  });
  assert.throws(
    () => protobuf.decodeMessage(root, encoded.messageType, Buffer.from([0x0a, 0x05, 0x6f])),
    /index out of range/,
  );
});

test('gRPC proto-loader preserves 64-bit values, enums, maps, and bytes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctuary-protobuf8-'));
  const filename = path.join(directory, 'wire.proto');
  fs.writeFileSync(filename, `syntax = "proto3";
package demo;
message Wire {
  int64 count = 1;
  enum Mode { MODE_UNSPECIFIED = 0; READY = 1; }
  Mode mode = 2;
  map<string, bytes> payloads = 3;
  bytes blob = 4;
}
`);
  try {
    const loader = require('@grpc/proto-loader');
    const protobuf = require('protobufjs');
    const definition = loader.loadSync(filename, { longs: String, enums: String, defaults: true });
    const root = protobuf.loadSync(filename);
    const type = root.lookupType('demo.Wire');
    const bytes = type.encode(type.fromObject({
      count: '9007199254740993',
      mode: 'READY',
      payloads: { alpha: Buffer.from([1, 2]) },
      blob: Buffer.from([3, 4]),
    })).finish();
    const message = definition['demo.Wire'].deserialize(bytes);
    assert.equal(message.count, '9007199254740993');
    assert.equal(message.mode, 'READY');
    assert.deepEqual(message.payloads.alpha, Buffer.from([1, 2]));
    assert.deepEqual(message.blob, Buffer.from([3, 4]));
    assert.deepEqual(
      definition['demo.Wire'].serialize(message),
      Buffer.from(bytes),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Firestore serializes large integers and binary values through its current parent', () => {
  const { Firestore, protos } = require('@google-cloud/firestore');
  const firestore = new Firestore({
    projectId: 'sanctuary-protobuf8-check',
    useBigInt: true,
  });
  const fields = firestore._serializer.encodeFields({
    count: 9007199254740993n,
    bytes: Buffer.from([1, 2]),
    nested: { mode: 'READY' },
  });
  assert.equal(fields.count.integerValue, '9007199254740993');
  assert.deepEqual(fields.bytes.bytesValue, Buffer.from([1, 2]));
  assert.equal(fields.nested.mapValue.fields.mode.stringValue, 'READY');
  const document = protos.google.firestore.v1.Document;
  const decoded = document.decode(document.encode({ fields }).finish());
  assert.equal(firestore._serializer.decodeValue(decoded.fields.count), 9007199254740993n);
  assert.deepEqual(firestore._serializer.decodeValue(decoded.fields.bytes), Buffer.from([1, 2]));
  assert.deepEqual(firestore._serializer.decodeValue(decoded.fields.nested), { mode: 'READY' });
});
