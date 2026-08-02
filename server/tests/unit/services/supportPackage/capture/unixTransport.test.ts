import { EventEmitter, once } from 'node:events';
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Server } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertLocalCaptureTransport,
  CAPTURE_SOCKET_DIRECTORY_MODE,
  CAPTURE_SOCKET_MODE,
  captureParticipantSocketPath,
  connectToCaptureSocket,
  createLocalCaptureTransportConfig,
  encodeCaptureFrame,
  isCaptureParticipantRequest,
  isCaptureParticipantResponse,
  listenOnCaptureSocket,
  MAX_CAPTURE_FRAME_BYTES,
  readCaptureFrame,
  requestCaptureParticipant,
  startCaptureParticipantServer,
  writeCaptureFrame,
} from '../../../../../src/services/supportPackage/capture/unixTransport';
import { createMembershipBarrier } from '../../../../../src/services/supportPackage/capture/roster';
import { ControlledCaptureObservationStore } from '../../../../../src/services/supportPackage/capture/observationStore';

let server: Server | undefined;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (server) server.close();
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  server = undefined;
  temporaryDirectory = undefined;
});

describe('controlled-capture Unix transport', () => {
  it('accepts only absolute single-host Unix-domain socket configuration', () => {
    expect(createLocalCaptureTransportConfig('/run/sanctuary/capture.sock')).toEqual({
      kind: 'unix',
      socketPath: '/run/sanctuary/capture.sock',
      multiHost: false,
    });
    expect(() => createLocalCaptureTransportConfig('capture.sock')).toThrow('capture_socket_path_invalid');
    expect(() => captureParticipantSocketPath('relative', 'api')).toThrow('capture_socket_directory_invalid');
    expect(() => assertLocalCaptureTransport(null)).toThrow('capture_transport_invalid');
    expect(() => assertLocalCaptureTransport({ kind: 'unix', multiHost: false }))
      .toThrow('capture_socket_path_invalid');
    expect(() => assertLocalCaptureTransport({
      kind: 'http',
      url: 'http://127.0.0.1:9000',
      multiHost: false,
    })).toThrow('capture_transport_must_be_single_host_unix');
    expect(() => assertLocalCaptureTransport({
      kind: 'unix',
      socketPath: '/run/capture.sock',
      multiHost: true,
    })).toThrow('capture_transport_must_be_single_host_unix');
  });

  it('binds a permissioned socket and connects without a TCP/HTTP fallback', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-'));
    const socketPath = join(temporaryDirectory, 'capture.sock');
    const config = createLocalCaptureTransportConfig(socketPath);
    const connected = vi.fn();
    server = await listenOnCaptureSocket(config, socket => {
      connected();
      socket.end();
    });

    const socketInfo = await stat(socketPath);
    expect(socketInfo.mode & 0o777).toBe(CAPTURE_SOCKET_MODE);
    const directoryInfo = await stat(temporaryDirectory);
    expect(directoryInfo.mode & 0o777).toBe(CAPTURE_SOCKET_DIRECTORY_MODE);

    const client = connectToCaptureSocket(config);
    await new Promise<void>((resolve, reject) => {
      client.once('close', () => resolve());
      client.once('error', reject);
    });
    expect(connected).toHaveBeenCalledOnce();
  });

  it('runs bounded arm/read/teardown lifecycle on a unique participant socket', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-participant-'));
    const membership = createMembershipBarrier(3, ['api']);
    const observations = new ControlledCaptureObservationStore();
    server = await startCaptureParticipantServer({
      socketDirectory: temporaryDirectory,
      participantId: 'api',
      membershipProvider: () => membership,
      observations,
    });
    const config = createLocalCaptureTransportConfig(
      captureParticipantSocketPath(temporaryDirectory, 'api'),
    );
    const session = { sessionId: 'session-a', generation: 9 };
    const selectors = {
      senderWalletId: 'private-sender',
      receiverWalletId: 'private-receiver',
      txid: 'a'.repeat(64),
    };

    await expect(requestCaptureParticipant(config, {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'arm',
      session,
      expiresAtMs: Date.now() + 60_000,
      membership,
      selectors,
    })).resolves.toMatchObject({ status: 'accepted', participantId: 'api' });

    observations.recordHandlerStarted({ walletId: selectors.receiverWalletId, txid: selectors.txid });
    const read = await requestCaptureParticipant(config, {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'read',
      session,
    });
    expect(read).toMatchObject({ status: 'evidence', participantId: 'api' });
    expect(JSON.stringify(read)).not.toContain('private-');

    await expect(requestCaptureParticipant(config, {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'status',
      session,
    })).resolves.toEqual({ status: 'present', participantId: 'api' });
    await expect(requestCaptureParticipant(config, {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'status',
      session: { ...session, generation: 8 },
    })).resolves.toEqual({ status: 'invalid', failure: 'session_mismatch' });
    await expect(requestCaptureParticipant(config, {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'read',
      session: { ...session, generation: 8 },
    })).resolves.toEqual({ status: 'invalid', failure: 'session_mismatch' });

    await expect(requestCaptureParticipant(config, {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'teardown',
      session,
    })).resolves.toEqual({ status: 'torn_down', participantId: 'api' });
    expect(observations.snapshot(session)).toBeNull();
  });

  it('rejects malformed selectors and membership before storing them', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-invalid-'));
    const membership = createMembershipBarrier(3, ['api']);
    const observations = new ControlledCaptureObservationStore();
    server = await startCaptureParticipantServer({
      socketDirectory: temporaryDirectory,
      participantId: 'api',
      membershipProvider: () => membership,
      observations,
    });
    const config = createLocalCaptureTransportConfig(
      captureParticipantSocketPath(temporaryDirectory, 'api'),
    );

    await expect(requestCaptureParticipant(config, {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'arm',
      session: { sessionId: 'session-a', generation: 9 },
      expiresAtMs: Date.now() + 60_000,
      membership,
      selectors: {
        senderWalletId: 'same-wallet',
        receiverWalletId: 'same-wallet',
        txid: 'not-a-txid',
      },
    })).resolves.toEqual({ status: 'invalid', failure: 'request_invalid' });
    expect(observations.snapshot({ sessionId: 'session-a', generation: 9 })).toBeNull();

    const changedMembership = createMembershipBarrier(4, ['api']);
    await expect(requestCaptureParticipant(config, {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'arm',
      session: { sessionId: 'session-a', generation: 9 },
      expiresAtMs: Date.now() + 60_000,
      membership: changedMembership,
      selectors: {
        senderWalletId: 'sender',
        receiverWalletId: 'receiver',
        txid: 'b'.repeat(64),
      },
    })).resolves.toEqual({ status: 'invalid', failure: 'membership_mismatch' });
  });

  it('does not replace a non-socket path during stale-socket recovery', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-occupied-'));
    const socketPath = captureParticipantSocketPath(temporaryDirectory, 'api');
    await writeFile(socketPath, 'do not replace');

    await expect(startCaptureParticipantServer({
      socketDirectory: temporaryDirectory,
      participantId: 'api',
      membershipProvider: () => createMembershipBarrier(1, ['api']),
      observations: new ControlledCaptureObservationStore(),
    })).rejects.toThrow('capture_socket_path_occupied');
    await expect(stat(socketPath)).resolves.toMatchObject({ size: 14 });
  });

  it('creates a new private socket directory and rejects unsafe directory states', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-directory-'));
    const createdDirectory = join(temporaryDirectory, 'new-private-directory');
    server = await startCaptureParticipantServer({
      socketDirectory: createdDirectory,
      participantId: 'api',
      membershipProvider: () => createMembershipBarrier(1, ['api']),
      observations: new ControlledCaptureObservationStore(),
    });
    expect((await stat(createdDirectory)).mode & 0o777).toBe(CAPTURE_SOCKET_DIRECTORY_MODE);
    await new Promise<void>(resolve => server?.close(() => resolve()));
    server = undefined;

    const publicDirectory = join(temporaryDirectory, 'public');
    await mkdir(publicDirectory, { mode: 0o755 });
    await chmod(publicDirectory, 0o755);
    await expect(startCaptureParticipantServer({
      socketDirectory: publicDirectory,
      participantId: 'api',
      membershipProvider: () => createMembershipBarrier(1, ['api']),
      observations: new ControlledCaptureObservationStore(),
    })).rejects.toThrow('capture_socket_directory_permissions_invalid');
    await expect(startCaptureParticipantServer({
      socketDirectory: '/',
      participantId: 'api',
      membershipProvider: () => createMembershipBarrier(1, ['api']),
      observations: new ControlledCaptureObservationStore(),
    })).rejects.toThrow('capture_socket_directory_invalid');
  });

  it('refuses to replace an active participant socket', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-active-'));
    const options = {
      socketDirectory: temporaryDirectory,
      participantId: 'api',
      membershipProvider: () => createMembershipBarrier(1, ['api']),
      observations: new ControlledCaptureObservationStore(),
    };
    server = await startCaptureParticipantServer(options);
    await expect(startCaptureParticipantServer(options)).rejects.toThrow('capture_socket_already_active');
  });

  it('rejects a server response outside the fixed categorical contract', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-response-'));
    const socketPath = join(temporaryDirectory, 'capture.sock');
    const config = createLocalCaptureTransportConfig(socketPath);
    server = await listenOnCaptureSocket(config, socket => {
      writeCaptureFrame(socket, { status: 'evidence', rawWalletId: 'secret' });
      socket.end();
    });
    await expect(requestCaptureParticipant(config, {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'status',
      session: { sessionId: 'session-a', generation: 1 },
    })).rejects.toThrow('capture_response_invalid');
  });

  it('strictly validates request keys, membership, selectors, and lifecycle operations', () => {
    const membership = createMembershipBarrier(1, ['api']);
    const validArm = {
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'arm',
      session: { sessionId: 'session-a', generation: 1 },
      expiresAtMs: Date.now() + 60_000,
      membership,
      selectors: { senderWalletId: 'sender', receiverWalletId: 'receiver', txid: 'a'.repeat(64) },
    };
    expect(isCaptureParticipantRequest(validArm)).toBe(true);
    expect(isCaptureParticipantRequest({
      protocol: 'sanctuary-controlled-capture-v1',
      operation: 'status',
      session: validArm.session,
    })).toBe(true);
    for (const invalid of [
      null,
      {},
      { ...validArm, extra: true },
      { ...validArm, protocol: 'wrong' },
      { ...validArm, session: null },
      { ...validArm, session: { sessionId: 'x', generation: 0 } },
      { ...validArm, membership: null },
      { ...validArm, membership: {} },
      { ...validArm, membership: { ...membership, generation: 0 } },
      { ...validArm, membership: { ...membership, generation: '1' } },
      { ...validArm, membership: { ...membership, digest: 1 } },
      { ...validArm, membership: { ...membership, expectedParticipants: 'api' } },
      { ...validArm, membership: { ...membership, expectedParticipants: [1] } },
      { ...validArm, membership: { ...membership, digest: 'bad' } },
      { ...validArm, membership: { ...membership, expectedParticipants: ['INVALID!'] } },
      { ...validArm, selectors: null },
      { ...validArm, selectors: { ...validArm.selectors, extra: true } },
      { ...validArm, selectors: { ...validArm.selectors, txid: 'bad' } },
      { protocol: 'sanctuary-controlled-capture-v1', operation: 'status', session: null },
      { protocol: 'sanctuary-controlled-capture-v1', operation: 'unknown', session: validArm.session },
    ]) expect(isCaptureParticipantRequest(invalid)).toBe(false);
  });

  it('strictly validates response categories and rejects raw or extra evidence fields', () => {
    const membership = createMembershipBarrier(1, ['api']);
    const observations = new ControlledCaptureObservationStore();
    const session = { sessionId: 'session-a', generation: 1 };
    observations.arm(session, {
      senderWalletId: 'sender', receiverWalletId: 'receiver', txid: 'a'.repeat(64),
    }, Date.now() + 60_000);
    const evidence = observations.snapshot(session);
    const withSenderObservation = (index: number, observation: object) => {
      const sender = [...(evidence?.roles.sender ?? [])];
      sender[index] = observation as never;
      return { session, roles: { sender, receiver: evidence?.roles.receiver } };
    };
    const validEnqueue = withSenderObservation(0, {
      stage: 'enqueue', outcome: 'accepted', failureClass: 'none', path: 'inline',
    });
    const validTerminal = withSenderObservation(2, {
      stage: 'terminal', outcome: 'accepted', failureClass: 'none',
      telegramOutcome: 'accepted', telegramFailureClass: 'none',
      terminalState: 'completed', path: 'queued',
    });
    for (const valid of [
      { status: 'invalid', failure: 'request_invalid' },
      { status: 'accepted', participantId: 'api', membership },
      { status: 'present', participantId: 'api' },
      { status: 'torn_down', participantId: 'api' },
      { status: 'evidence', participantId: 'api', evidence },
      { status: 'evidence', participantId: 'api', evidence: validEnqueue },
      { status: 'evidence', participantId: 'api', evidence: validTerminal },
      { status: 'evidence', participantId: 'api', evidence: null },
    ]) expect(isCaptureParticipantResponse(valid)).toBe(true);
    for (const invalid of [
      null,
      {},
      { status: 'invalid', failure: 'secret', raw: 'id' },
      { status: 'accepted', participantId: 'api', membership: { ...membership, digest: 'bad' } },
      { status: 'present' },
      { status: 'present', participantId: 'api', extra: true },
      { status: 'evidence', participantId: 'api', evidence: { ...evidence, rawWalletId: 'secret' } },
      { status: 'evidence', participantId: 'api', evidence: 1 },
      { status: 'evidence', participantId: 'api', evidence: { session, roles: {} } },
      { status: 'evidence', participantId: 'api', evidence: {
        session,
        roles: { sender: [null, null, null], receiver: evidence?.roles.receiver },
      } },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(0, {
        stage: 'enqueue', outcome: 'bogus', failureClass: 'none', path: 'queued',
      }) },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(0, {
        stage: 'enqueue', outcome: 'accepted', failureClass: 1, path: 'queued',
      }) },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(0, {
        stage: 'enqueue', outcome: 'accepted', failureClass: 'bogus', path: 'queued',
      }) },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(0, {
        stage: 'enqueue', outcome: 'accepted', failureClass: 'none', path: 'network',
      }) },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(2, {
        stage: 'terminal', outcome: 'bogus', failureClass: 'none',
        telegramOutcome: 'accepted', telegramFailureClass: 'none', terminalState: 'completed', path: 'queued',
      }) },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(2, {
        stage: 'terminal', outcome: 'accepted', failureClass: 'bogus',
        telegramOutcome: 'accepted', telegramFailureClass: 'none', terminalState: 'completed', path: 'queued',
      }) },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(2, {
        stage: 'terminal', outcome: 'accepted', failureClass: 'none',
        telegramOutcome: 'bogus', telegramFailureClass: 'none', terminalState: 'completed', path: 'queued',
      }) },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(2, {
        stage: 'terminal', outcome: 'accepted', failureClass: 'none',
        telegramOutcome: 'accepted', telegramFailureClass: 'bogus', terminalState: 'completed', path: 'queued',
      }) },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(2, {
        stage: 'terminal', outcome: 'accepted', failureClass: 'none',
        telegramOutcome: 'accepted', telegramFailureClass: 'none', terminalState: 'completed', path: 'network',
      }) },
      { status: 'evidence', participantId: 'api', evidence: withSenderObservation(2, {
        stage: 'terminal', outcome: 'accepted', failureClass: 'none',
        telegramOutcome: 'accepted', telegramFailureClass: 'none', terminalState: 'unknown', path: 'inline',
      }) },
      { status: 'evidence', participantId: 'api', evidence: {
        session,
        roles: {
          sender: [{ stage: 'handler', outcome: 'wrong' }, ...(evidence?.roles.sender.slice(1) ?? [])],
          receiver: evidence?.roles.receiver,
        },
      } },
      { status: 'evidence', participantId: 'api', evidence: {
        session,
        roles: {
          sender: [
            { stage: 'enqueue', outcome: 1, failureClass: 'none', path: 'queued' },
            ...(evidence?.roles.sender.slice(1) ?? []),
          ],
          receiver: evidence?.roles.receiver,
        },
      } },
    ]) expect(isCaptureParticipantResponse(invalid)).toBe(false);
  });

  it('bounds encoded frames and rejects malformed receive frames without logging content', async () => {
    expect(() => encodeCaptureFrame({ value: 'x'.repeat(MAX_CAPTURE_FRAME_BYTES) }))
      .toThrow('capture_frame_size_invalid');

    class FakeSocket extends EventEmitter {
      setTimeout() { return this; }
    }
    const header = (length: number) => {
      const value = Buffer.alloc(4);
      value.writeUInt32BE(length);
      return value;
    };
    for (const event of ['error', 'timeout', 'close'] as const) {
      const socket = new FakeSocket();
      const reading = readCaptureFrame(socket as never);
      if (event === 'error') socket.emit(event, new Error('socket error'));
      else socket.emit(event);
      await expect(reading).rejects.toBeInstanceOf(Error);
    }
    for (const frame of [
      header(0),
      header(MAX_CAPTURE_FRAME_BYTES + 1),
      Buffer.concat([header(1), Buffer.from('xx')]),
      Buffer.concat([header(1), Buffer.from('{')]),
      Buffer.alloc(MAX_CAPTURE_FRAME_BYTES + 5),
    ]) {
      const socket = new FakeSocket();
      const reading = readCaptureFrame(socket as never);
      socket.emit('data', frame);
      await expect(reading).rejects.toBeInstanceOf(Error);
    }
    const encoded = encodeCaptureFrame({ safe: true });
    const socket = new FakeSocket();
    const reading = readCaptureFrame(socket as never);
    socket.emit('data', encoded.subarray(0, 2));
    socket.emit('data', encoded.subarray(2));
    await expect(reading).resolves.toEqual({ safe: true });
  });

  it('returns a fixed invalid response for a malformed participant frame', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-malformed-'));
    server = await startCaptureParticipantServer({
      socketDirectory: temporaryDirectory,
      participantId: 'api',
      membershipProvider: () => createMembershipBarrier(1, ['api']),
      observations: new ControlledCaptureObservationStore(),
    });
    const config = createLocalCaptureTransportConfig(
      captureParticipantSocketPath(temporaryDirectory, 'api'),
    );
    const client = connectToCaptureSocket(config);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    writeCaptureFrame(client, { unexpected: true });
    await expect(readCaptureFrame(client)).resolves.toEqual({
      status: 'invalid', failure: 'request_invalid',
    });
    client.destroy();
  });

  it('rejects a file used as the socket directory and a duplicate generic listener', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-file-directory-'));
    const filePath = join(temporaryDirectory, 'not-a-directory');
    await writeFile(filePath, 'file');
    await expect(startCaptureParticipantServer({
      socketDirectory: filePath,
      participantId: 'api',
      membershipProvider: () => createMembershipBarrier(1, ['api']),
      observations: new ControlledCaptureObservationStore(),
    })).rejects.toThrow('capture_socket_directory_invalid');

    const socketPath = join(temporaryDirectory, 'duplicate.sock');
    const config = createLocalCaptureTransportConfig(socketPath);
    server = await listenOnCaptureSocket(config, socket => socket.end());
    await expect(listenOnCaptureSocket(config, socket => socket.end())).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
  });

  it('recovers an exact stale socket left by a crashed same-host participant', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sanctuary-capture-stale-'));
    const socketPath = captureParticipantSocketPath(temporaryDirectory, 'api');
    const child = spawn(process.execPath, [
      '-e',
      "const net=require('node:net'); const s=net.createServer(); s.listen(process.argv[1],()=>process.stdout.write('ready'));",
      socketPath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    await once(child.stdout, 'data');
    child.kill('SIGKILL');
    await once(child, 'exit');
    expect((await stat(socketPath)).isSocket()).toBe(true);

    server = await startCaptureParticipantServer({
      socketDirectory: temporaryDirectory,
      participantId: 'api',
      membershipProvider: () => createMembershipBarrier(1, ['api']),
      observations: new ControlledCaptureObservationStore(),
    });
    expect((await stat(socketPath)).isSocket()).toBe(true);
  });
});
