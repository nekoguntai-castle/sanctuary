/**
 * Payjoin Service (BIP78) - Re-export Barrel
 *
 * This file re-exports from the modularized payjoin/ directory
 * to maintain backward compatibility with existing imports.
 *
 * New code should import directly from '../services/payjoin'.
 */

export {
  PayjoinErrors,
  type PayjoinErrorCode,
  type PayjoinResult,
  type PayjoinValidation,
  isPrivateIP,
  validatePayjoinUrl,
  parseBip21Uri,
  generateBip21Uri,
  processPayjoinRequest,
  attemptPayjoinSend,
} from './payjoin';
