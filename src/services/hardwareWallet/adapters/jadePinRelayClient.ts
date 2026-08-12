import { z } from 'zod';
import apiClient from '../../../api/client';
import type { JadePinRelay } from './jadeProtocol';

const JadePinRelayResponseSchema = z.json();

/** One-shot same-origin relay; mutations have no transport retry. */
export const relayJadePinRequest: JadePinRelay = async request => (
  apiClient.post('/hardware/jade/pin', request, {
    timeoutMs: 15_000,
    schema: JadePinRelayResponseSchema,
  })
);
