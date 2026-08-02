import type { Server } from 'node:net';
import { getRedisClient } from '../../infrastructure/redis';
import {
  ControlledCaptureService,
  controlledCaptureObservations,
  createMembershipBarrier,
  normalizeParticipantId,
  startCaptureParticipantServer,
  type CaptureMembershipBarrier,
} from './capture';

const DEFAULT_SOCKET_DIRECTORY = '/run/sanctuary-support-capture';
const DEFAULT_PARTICIPANTS = ['api', 'notification-worker'] as const;

let participantServer: Server | null = null;
let controller: ControlledCaptureService | null = null;

function parseGeneration(): number {
  const value = Number(process.env.SUPPORT_CAPTURE_MEMBERSHIP_GENERATION ?? '1');
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('capture_membership_generation_invalid');
  }
  return value;
}

function expectedParticipants(): string[] {
  const configured = process.env.SUPPORT_CAPTURE_EXPECTED_PARTICIPANTS;
  const participants = configured
    ? configured.split(',').map(normalizeParticipantId)
    : [...DEFAULT_PARTICIPANTS];
  const unique = [...new Set(participants)].sort();
  if (unique.length !== DEFAULT_PARTICIPANTS.length
    || !DEFAULT_PARTICIPANTS.every(item => unique.includes(item))) {
    throw new Error('capture_participant_roster_invalid');
  }
  return unique;
}

export function getCaptureMembership(): CaptureMembershipBarrier {
  return createMembershipBarrier(parseGeneration(), expectedParticipants());
}

export function getCaptureSocketDirectory(): string {
  return process.env.SUPPORT_CAPTURE_SOCKET_DIR ?? DEFAULT_SOCKET_DIRECTORY;
}

export function getControlledCaptureService(): ControlledCaptureService | null {
  if (controller) return controller;
  const redis = getRedisClient();
  if (!redis) return null;
  controller = new ControlledCaptureService({
    redis,
    socketDirectory: getCaptureSocketDirectory(),
    membershipProvider: getCaptureMembership,
  });
  return controller;
}

export async function startCaptureParticipant(participantId: 'api' | 'notification-worker'): Promise<void> {
  if (participantServer) return;
  participantServer = await startCaptureParticipantServer({
    socketDirectory: getCaptureSocketDirectory(),
    participantId,
    membershipProvider: getCaptureMembership,
    observations: controlledCaptureObservations,
  });
}

export async function stopCaptureParticipant(): Promise<void> {
  const server = participantServer;
  participantServer = null;
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}
