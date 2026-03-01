/**
 * Advanced Transaction Features
 *
 * Implements advanced Bitcoin transaction functionality including:
 * - RBF (Replace-By-Fee)
 * - CPFP (Child-Pays-For-Parent)
 * - Batch transactions
 * - Advanced fee estimation
 */

// Constants and shared utilities
export { RBF_SEQUENCE, MAX_RBF_SEQUENCE, MIN_RBF_FEE_BUMP, CPFP_MIN_FEE_RATE } from './shared';

// RBF functionality
export { isRBFSignaled, canReplaceTransaction, createRBFTransaction } from './rbf';

// CPFP functionality
export { calculateCPFPFee, createCPFPTransaction } from './cpfp';

// Batch transaction functionality
export { createBatchTransaction } from './batch';

// Advanced fee estimation
export { getAdvancedFeeEstimates, estimateOptimalFee } from './feeEstimation';
