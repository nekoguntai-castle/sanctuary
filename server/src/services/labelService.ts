/**
 * Label Service
 *
 * Business logic for label management operations.
 * Handles labels, transaction labels, and address labels.
 */

import type { Label } from '../generated/prisma/client';
import { labelRepository, LabelWithCounts, LabelWithAssociations } from '../repositories';
import {
  requireTransactionAccess,
  requireTransactionEditAccess,
  requireAddressAccess,
  requireAddressEditAccess,
} from './accessControl';
import { NotFoundError, ConflictError, InvalidInputError } from '../errors';
import { createLogger } from '../utils/logger';

const log = createLogger('LABEL:SVC');

// ========================================
// LABEL CRUD OPERATIONS
// ========================================

/**
 * Get all labels for a wallet
 *
 * Access control: handled by requireWalletAccess('view') middleware at route level
 */
export async function getLabelsForWallet(
  walletId: string
): Promise<LabelWithCounts[]> {
  return labelRepository.findByWalletId(walletId);
}

/**
 * Get a specific label with all associations
 *
 * Access control: handled by requireWalletAccess('view') middleware at route level
 */
export async function getLabel(
  walletId: string,
  labelId: string
): Promise<LabelWithAssociations> {
  const label = await labelRepository.findByIdWithAssociations(labelId, walletId);
  if (!label) {
    throw new NotFoundError('Label not found');
  }

  return label;
}

/**
 * Create a new label
 *
 * Access control: handled by requireWalletAccess('edit') middleware at route level
 */
export async function createLabel(
  walletId: string,
  data: { name: string; color?: string; description?: string | null }
): Promise<Label> {
  // Validate name
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    throw new InvalidInputError('Label name is required', 'name');
  }

  const name = data.name.trim();

  // Check for duplicate
  const existing = await labelRepository.findByNameInWallet(walletId, name);
  if (existing) {
    throw new ConflictError('A label with this name already exists');
  }

  const label = await labelRepository.create({
    walletId,
    name,
    color: data.color,
    description: data.description || null,
  });

  log.info('Label created', { labelId: label.id, walletId });
  return label;
}

/**
 * Update a label
 *
 * Access control: handled by requireWalletAccess('edit') middleware at route level
 */
export async function updateLabel(
  walletId: string,
  labelId: string,
  data: { name?: string; color?: string; description?: string | null }
): Promise<Label> {
  // Check label exists
  const existing = await labelRepository.findByIdInWallet(labelId, walletId);
  if (!existing) {
    throw new NotFoundError('Label not found');
  }

  // Check for duplicate name if changing
  if (data.name && data.name.trim() !== existing.name) {
    const isTaken = await labelRepository.isNameTakenByOther(walletId, data.name.trim(), labelId);
    if (isTaken) {
      throw new ConflictError('A label with this name already exists');
    }
  }

  const label = await labelRepository.update(labelId, {
    name: data.name,
    color: data.color,
    description: data.description,
  });

  log.info('Label updated', { labelId, walletId });
  return label;
}

/**
 * Delete a label
 *
 * Access control: handled by requireWalletAccess('edit') middleware at route level
 */
export async function deleteLabel(
  walletId: string,
  labelId: string
): Promise<void> {
  // Check label exists
  const label = await labelRepository.findByIdInWallet(labelId, walletId);
  if (!label) {
    throw new NotFoundError('Label not found');
  }

  await labelRepository.remove(labelId);
  log.info('Label deleted', { labelId, walletId });
}

// ========================================
// TRANSACTION LABEL OPERATIONS
// ========================================

/**
 * Get labels for a transaction
 */
export async function getTransactionLabels(
  transactionId: string,
  userId: string
): Promise<Label[]> {
  await requireTransactionAccess(transactionId, userId);
  return labelRepository.getLabelsForTransaction(transactionId);
}

/**
 * Add labels to a transaction
 */
export async function addTransactionLabels(
  transactionId: string,
  userId: string,
  labelIds: string[]
): Promise<Label[]> {
  if (!Array.isArray(labelIds) || labelIds.length === 0) {
    throw new InvalidInputError('labelIds array is required');
  }

  const { walletId } = await requireTransactionEditAccess(transactionId, userId);

  // Verify all labels belong to the same wallet
  const labels = await labelRepository.findManyByIdsInWallet(labelIds, walletId);
  if (labels.length !== labelIds.length) {
    throw new InvalidInputError('One or more labels not found or belong to a different wallet');
  }

  await labelRepository.addLabelsToTransaction(transactionId, labelIds);
  log.debug('Labels added to transaction', { transactionId, count: labelIds.length });

  return labelRepository.getLabelsForTransaction(transactionId);
}

/**
 * Replace all labels on a transaction
 */
export async function replaceTransactionLabels(
  transactionId: string,
  userId: string,
  labelIds: string[]
): Promise<Label[]> {
  if (!Array.isArray(labelIds)) {
    throw new InvalidInputError('labelIds array is required');
  }

  const { walletId } = await requireTransactionEditAccess(transactionId, userId);

  // Verify all labels belong to the same wallet (if any)
  if (labelIds.length > 0) {
    const labels = await labelRepository.findManyByIdsInWallet(labelIds, walletId);
    if (labels.length !== labelIds.length) {
      throw new InvalidInputError('One or more labels not found or belong to a different wallet');
    }
  }

  await labelRepository.replaceTransactionLabels(transactionId, labelIds);
  log.debug('Transaction labels replaced', { transactionId, count: labelIds.length });

  return labelRepository.getLabelsForTransaction(transactionId);
}

/**
 * Remove a label from a transaction
 */
export async function removeTransactionLabel(
  transactionId: string,
  labelId: string,
  userId: string
): Promise<void> {
  await requireTransactionEditAccess(transactionId, userId);
  await labelRepository.removeLabelFromTransaction(transactionId, labelId);
  log.debug('Label removed from transaction', { transactionId, labelId });
}

// ========================================
// ADDRESS LABEL OPERATIONS
// ========================================

/**
 * Get labels for an address
 */
export async function getAddressLabels(
  addressId: string,
  userId: string
): Promise<Label[]> {
  await requireAddressAccess(addressId, userId);
  return labelRepository.getLabelsForAddress(addressId);
}

/**
 * Add labels to an address
 */
export async function addAddressLabels(
  addressId: string,
  userId: string,
  labelIds: string[]
): Promise<Label[]> {
  if (!Array.isArray(labelIds) || labelIds.length === 0) {
    throw new InvalidInputError('labelIds array is required');
  }

  const { walletId } = await requireAddressEditAccess(addressId, userId);

  // Verify all labels belong to the same wallet
  const labels = await labelRepository.findManyByIdsInWallet(labelIds, walletId);
  if (labels.length !== labelIds.length) {
    throw new InvalidInputError('One or more labels not found or belong to a different wallet');
  }

  await labelRepository.addLabelsToAddress(addressId, labelIds);
  log.debug('Labels added to address', { addressId, count: labelIds.length });

  return labelRepository.getLabelsForAddress(addressId);
}

/**
 * Replace all labels on an address
 */
export async function replaceAddressLabels(
  addressId: string,
  userId: string,
  labelIds: string[]
): Promise<Label[]> {
  if (!Array.isArray(labelIds)) {
    throw new InvalidInputError('labelIds array is required');
  }

  const { walletId } = await requireAddressEditAccess(addressId, userId);

  // Verify all labels belong to the same wallet (if any)
  if (labelIds.length > 0) {
    const labels = await labelRepository.findManyByIdsInWallet(labelIds, walletId);
    if (labels.length !== labelIds.length) {
      throw new InvalidInputError('One or more labels not found or belong to a different wallet');
    }
  }

  await labelRepository.replaceAddressLabels(addressId, labelIds);
  log.debug('Address labels replaced', { addressId, count: labelIds.length });

  return labelRepository.getLabelsForAddress(addressId);
}

/**
 * Remove a label from an address
 */
export async function removeAddressLabel(
  addressId: string,
  labelId: string,
  userId: string
): Promise<void> {
  await requireAddressEditAccess(addressId, userId);
  await labelRepository.removeLabelFromAddress(addressId, labelId);
  log.debug('Label removed from address', { addressId, labelId });
}

// Export as namespace
export const labelService = {
  // Label CRUD
  getLabelsForWallet,
  getLabel,
  createLabel,
  updateLabel,
  deleteLabel,
  // Transaction labels
  getTransactionLabels,
  addTransactionLabels,
  replaceTransactionLabels,
  removeTransactionLabel,
  // Address labels
  getAddressLabels,
  addAddressLabels,
  replaceAddressLabels,
  removeAddressLabel,
};

export default labelService;
