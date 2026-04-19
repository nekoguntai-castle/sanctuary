export function TransactionTableHeader({
  showWalletBadge,
  showBalance,
}: {
  showWalletBadge: boolean;
  showBalance: boolean;
}) {
  return (
    <tr className="surface-muted">
      <HeaderCell label="Date" align="left" />
      <HeaderCell label="Type" align="left" />
      <HeaderCell label="Amount" align="right" />
      {showBalance && <HeaderCell label="Balance" align="right" />}
      <HeaderCell label="Confs" align="center" />
      <HeaderCell label="Labels" align="left" />
      {showWalletBadge && <HeaderCell label="Wallet" align="left" />}
    </tr>
  );
}

function HeaderCell({ label, align }: { label: string; align: 'left' | 'right' | 'center' }) {
  const alignClass = getHeaderAlignClass(align);

  return (
    <th scope="col" className={`px-4 py-3 ${alignClass} text-xs font-medium text-sanctuary-500 uppercase tracking-wider`}>
      {label}
    </th>
  );
}

function getHeaderAlignClass(align: 'left' | 'right' | 'center'): string {
  if (align === 'right') {
    return 'text-right';
  }

  if (align === 'center') {
    return 'text-center';
  }

  return 'text-left';
}
