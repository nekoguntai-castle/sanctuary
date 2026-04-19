import type { Wallet } from '../../src/api/wallets';

export function WalletSparkline({
  wallet,
  isMultisig,
  values,
}: {
  wallet: Wallet;
  isMultisig: boolean;
  values?: number[];
}) {
  const color = isMultisig ? 'var(--color-warning-500)' : 'var(--color-success-500)';

  return (
    <div className="h-8 w-full mt-2 opacity-30 overflow-hidden">
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-full">
        <defs>
          <linearGradient id={`spark-${wallet.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {values ? (
          <RealSparkline walletId={wallet.id} values={values} color={color} />
        ) : (
          <DecorativeSparkline wallet={wallet} color={color} />
        )}
      </svg>
    </div>
  );
}

function RealSparkline({
  walletId,
  values,
  color,
}: {
  walletId: string;
  values: number[];
  color: string;
}) {
  return (
    <>
      <path
        d={sparklineAreaPath(values)}
        fill={`url(#spark-${walletId})`}
      />
      <path
        d={sparklinePath(values)}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

function DecorativeSparkline({
  wallet,
  color,
}: {
  wallet: Wallet;
  color: string;
}) {
  return (
    <path
      d={`M0,20 Q10,${15 + (wallet.balance % 7)} 20,${18 - (wallet.balance % 5)} T40,${14 + (wallet.balance % 8)} T60,${10 + (wallet.balance % 6)} T80,${16 - (wallet.balance % 4)} T100,${12 + (wallet.balance % 5)}`}
      fill={`url(#spark-${wallet.id})`}
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  );
}

function sparklinePath(values: number[]): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = 100 / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * stepX;
      const y = 28 - ((value - min) / range) * 24;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function sparklineAreaPath(values: number[]): string {
  const line = sparklinePath(values);
  if (!line) return '';
  return `${line} L100,30 L0,30 Z`;
}
