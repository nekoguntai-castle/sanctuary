import type { Transaction } from '../../../types';
import {
  getCounterpartyAddressTitle,
  getOwnAddressTitle,
  getOwnAddressValue,
} from './detailsModel';

type TransactionAddressBlocksProps = {
  selectedTx: Transaction;
  walletAddresses: string[];
};

export function TransactionAddressBlocks({
  selectedTx,
  walletAddresses,
}: TransactionAddressBlocksProps) {
  return (
    <>
      <CounterpartyAddressBlock selectedTx={selectedTx} walletAddresses={walletAddresses} />
      <OwnAddressBlock selectedTx={selectedTx} />
    </>
  );
}

function CounterpartyAddressBlock({
  selectedTx,
  walletAddresses,
}: TransactionAddressBlocksProps) {
  if (!selectedTx.counterpartyAddress) {
    return null;
  }

  return (
    <div className="surface-muted p-4 rounded-lg border border-sanctuary-100 dark:border-sanctuary-800">
      <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">
        {getCounterpartyAddressTitle(selectedTx, walletAddresses)}
      </p>
      <code className="text-xs font-mono break-all text-sanctuary-700 dark:text-sanctuary-300">
        {selectedTx.counterpartyAddress}
      </code>
    </div>
  );
}

function OwnAddressBlock({ selectedTx }: { selectedTx: Transaction }) {
  if (!selectedTx.address) {
    return null;
  }

  return (
    <div className="surface-muted p-4 rounded-lg border border-sanctuary-100 dark:border-sanctuary-800">
      <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">
        {getOwnAddressTitle(selectedTx)}
      </p>
      <code className="text-xs font-mono break-all text-sanctuary-700 dark:text-sanctuary-300">
        {getOwnAddressValue(selectedTx)}
      </code>
    </div>
  );
}
