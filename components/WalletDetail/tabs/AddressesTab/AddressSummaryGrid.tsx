import type { AddressSummary } from '../../../../src/api/transactions';
import type { AddressFormat } from './types';

export function AddressSummaryGrid({
  addressSummary,
  format,
}: {
  addressSummary: AddressSummary | null;
  format: AddressFormat;
}) {
  if (!addressSummary) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <SummaryCard
        label="Total Addresses"
        value={addressSummary.totalAddresses}
        detail={`${addressSummary.usedCount} used · ${addressSummary.unusedCount} unused`}
      />
      <SummaryCard label="Total Balance" value={format(addressSummary.totalBalance)} />
      <SummaryCard label="Used Balance" value={format(addressSummary.usedBalance)} />
      <SummaryCard label="Unused Balance" value={format(addressSummary.unusedBalance)} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
      <p className="text-xs uppercase tracking-wide text-sanctuary-500">{label}</p>
      <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-1">
        {value}
      </p>
      {detail && <p className="text-xs text-sanctuary-500 mt-2">{detail}</p>}
    </div>
  );
}
