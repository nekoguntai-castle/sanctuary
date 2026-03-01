/**
 * Transactions - Drafting Router
 *
 * Endpoints for creating unsigned PSBTs (transaction drafts)
 * including single, batch, and estimation flows.
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { validateAddress } from '../../services/bitcoin/utils';
import { MIN_FEE_RATE } from '../../constants';

const router = Router();
const log = createLogger('TX:DRAFT');

/**
 * POST /api/v1/wallets/:walletId/transactions/create
 * Create a new transaction PSBT (returns PSBT for hardware wallet signing)
 */
router.post('/wallets/:walletId/transactions/create', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const {
      recipient,
      amount,
      feeRate,
      selectedUtxoIds,
      enableRBF = true,
      label,
      memo,
      sendMax = false,
      subtractFees = false,
      decoyOutputs,
    } = req.body;

    log.debug('Create transaction request', {
      walletId,
      recipient: recipient?.substring(0, 20) + '...',
      amount,
      feeRate,
      sendMax,
      subtractFees,
      decoyOutputs,
      hasSelectedUtxos: !!selectedUtxoIds?.length,
    });

    // Basic validation
    if (!recipient || !amount) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'recipient and amount are required',
      });
    }

    if (!feeRate || feeRate < MIN_FEE_RATE) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `feeRate must be at least ${MIN_FEE_RATE} sat/vB`,
      });
    }

    // Fetch wallet data
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Validate Bitcoin address for the wallet's network
    const network = wallet.network as 'mainnet' | 'testnet' | 'regtest';
    const addressValidation = validateAddress(recipient, network);
    if (!addressValidation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid Bitcoin address: ${addressValidation.error}`,
      });
    }

    // Create transaction
    const txService = await import('../../services/bitcoin/transactionService');
    const txData = await txService.createTransaction(
      walletId,
      recipient,
      amount,
      feeRate,
      {
        selectedUtxoIds,
        enableRBF,
        label,
        memo,
        sendMax,
        subtractFees,
        decoyOutputs,
      }
    );

    log.debug('Create transaction response', {
      fee: txData.fee,
      changeAmount: txData.changeAmount,
      effectiveAmount: txData.effectiveAmount,
      decoyOutputsCount: txData.decoyOutputs?.length || 0,
      decoyOutputs: txData.decoyOutputs,
    });

    res.json({
      psbtBase64: txData.psbtBase64,
      fee: txData.fee,
      totalInput: txData.totalInput,
      totalOutput: txData.totalOutput,
      changeAmount: txData.changeAmount,
      changeAddress: txData.changeAddress,
      utxos: txData.utxos,
      inputPaths: txData.inputPaths, // Derivation paths for hardware wallet signing
      effectiveAmount: txData.effectiveAmount, // The actual amount being sent
      decoyOutputs: txData.decoyOutputs, // Decoy change outputs (if enabled)
    });
  } catch (error) {
    log.error('Create transaction error', { error });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to create transaction'),
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/transactions/batch
 * Create a batch transaction with multiple outputs
 */
router.post('/wallets/:walletId/transactions/batch', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const {
      outputs, // Array of { address, amount, sendMax? }
      feeRate,
      selectedUtxoIds,
      enableRBF = true,
      label,
      memo,
    } = req.body;

    // Validate outputs array
    if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'outputs array is required with at least one output',
      });
    }

    if (!feeRate || feeRate < MIN_FEE_RATE) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `feeRate must be at least ${MIN_FEE_RATE} sat/vB`,
      });
    }

    // Fetch wallet for network validation
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    const network = wallet.network as 'mainnet' | 'testnet' | 'regtest';

    // Validate each output
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      if (!output.address) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Output ${i + 1}: address is required`,
        });
      }

      // Amount is required unless sendMax is true
      if (!output.sendMax && (!output.amount || output.amount <= 0)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Output ${i + 1}: amount is required (or set sendMax: true)`,
        });
      }

      // Validate address
      const addressValidation = validateAddress(output.address, network);
      if (!addressValidation.valid) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Output ${i + 1}: Invalid Bitcoin address: ${addressValidation.error}`,
        });
      }
    }

    // Only one output can have sendMax
    const sendMaxCount = outputs.filter((o: { sendMax?: boolean }) => o.sendMax).length;
    if (sendMaxCount > 1) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Only one output can have sendMax enabled',
      });
    }

    // Create batch transaction
    const txService = await import('../../services/bitcoin/transactionService');
    const txData = await txService.createBatchTransaction(
      walletId,
      outputs,
      feeRate,
      {
        selectedUtxoIds,
        enableRBF,
        label,
        memo,
      }
    );

    res.json({
      psbtBase64: txData.psbtBase64,
      fee: txData.fee,
      totalInput: txData.totalInput,
      totalOutput: txData.totalOutput,
      changeAmount: txData.changeAmount,
      changeAddress: txData.changeAddress,
      utxos: txData.utxos,
      inputPaths: txData.inputPaths,
      outputs: txData.outputs, // Final outputs with resolved amounts
    });
  } catch (error) {
    log.error('Create batch transaction error', { error });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to create batch transaction'),
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/transactions/estimate
 * Estimate transaction cost before creating
 */
router.post('/wallets/:walletId/transactions/estimate', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { recipient, amount, feeRate, selectedUtxoIds } = req.body;

    // Validation
    if (!recipient || !amount || !feeRate) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'recipient, amount, and feeRate are required',
      });
    }

    // Estimate transaction
    const txService = await import('../../services/bitcoin/transactionService');
    const estimate = await txService.estimateTransaction(
      walletId,
      recipient,
      amount,
      feeRate,
      selectedUtxoIds
    );

    res.json(estimate);
  } catch (error) {
    log.error('Estimate transaction error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: getErrorMessage(error, 'Failed to estimate transaction'),
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/psbt/create
 * Create a PSBT for hardware wallet signing
 * This is the preferred endpoint for hardware wallet integrations
 */
router.post('/wallets/:walletId/psbt/create', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const {
      recipients, // Array of { address, amount }
      feeRate,
      utxoIds, // Optional: specific UTXOs to use
      changeAddress, // Optional: custom change address
    } = req.body;

    // Validation
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'recipients array is required',
      });
    }

    if (!feeRate || feeRate < MIN_FEE_RATE) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `feeRate must be at least ${MIN_FEE_RATE} sat/vB`,
      });
    }

    // Validate recipients
    for (const recipient of recipients) {
      if (!recipient.address || !recipient.amount) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Each recipient must have address and amount',
        });
      }
    }

    // For now, only support single recipient (can be extended later)
    const { address, amount } = recipients[0];

    // Create PSBT
    const txService = await import('../../services/bitcoin/transactionService');
    const txData = await txService.createTransaction(
      walletId,
      address,
      amount,
      feeRate,
      {
        selectedUtxoIds: utxoIds,
        enableRBF: true,
      }
    );

    res.json({
      psbt: txData.psbtBase64,
      fee: txData.fee,
      inputPaths: txData.inputPaths,
      totalInput: txData.totalInput,
      totalOutput: txData.totalOutput,
      changeAmount: txData.changeAmount,
      changeAddress: txData.changeAddress,
      utxos: txData.utxos,
    });
  } catch (error) {
    log.error('Create PSBT error', { error });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to create PSBT'),
    });
  }
});

export default router;
