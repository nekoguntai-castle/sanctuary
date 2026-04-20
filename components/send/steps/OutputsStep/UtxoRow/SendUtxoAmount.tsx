interface SendUtxoAmountProps {
  amount: number;
  format: (amount: number) => string;
  formatFiat: (amount: number) => string | null;
}

export function SendUtxoAmount({ amount, format, formatFiat }: SendUtxoAmountProps) {
  const fiatAmount = formatFiat(amount);

  return (
    <div className="text-right">
      <div className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100">
        {format(amount)}
      </div>
      {fiatAmount && (
        <div className="text-[10px] text-sanctuary-500">
          {fiatAmount}
        </div>
      )}
    </div>
  );
}
