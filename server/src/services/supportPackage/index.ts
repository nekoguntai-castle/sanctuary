/**
 * Support Package Service
 *
 * Generates privacy-safe diagnostic bundles for remote troubleshooting.
 */

export { generateSupportPackage, generateSerializedSupportPackage } from './runner';
export { generateSerializedIncidentProfile } from './incidentProfile';
export { createAnonymizer, generateSalt } from './anonymizer';
export type { SupportPackage, CollectorContext, CollectorResult, Collector, GenerateOptions } from './types';
