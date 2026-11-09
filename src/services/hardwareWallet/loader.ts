import { memoizeUntilRejected } from '../../utils/memoizeUntilRejected';

export const loadHardwareWalletRuntime = memoizeUntilRejected(() => import('./runtime'));
