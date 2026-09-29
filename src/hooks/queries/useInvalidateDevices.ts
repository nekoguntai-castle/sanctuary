import { createInvalidateAll } from './factory';
import { deviceKeys } from './deviceKeys';

/** Refresh active device lists and details after any accepted device write. */
export const useInvalidateDevices = createInvalidateAll(deviceKeys);
