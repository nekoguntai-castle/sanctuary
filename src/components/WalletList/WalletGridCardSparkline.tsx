import type { Wallet } from '../../api/wallets';
import type { WalletSparklineResult } from '../../hooks/queries/useWallets';

type SparklineValues = Extract<WalletSparklineResult, { status: 'ready' }>['values'];

export function WalletSparkline({
  wallet,
  isMultisig,
  result,
}: {
  wallet: Wallet;
  isMultisig: boolean;
  result: WalletSparklineResult;
}) {
  const color = isMultisig ? 'var(--color-warning-500)' : 'var(--color-success-500)';

  if (result.status !== 'ready') {
    return <EmptySparkline status={result.status} />;
  }

  return (
    <div className="h-8 w-full mt-2 opacity-30 overflow-hidden">
      <svg
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        className="w-full h-full"
        role="img"
        aria-label={`Balance history for ${wallet.name}`}
      >
        <defs>
          <linearGradient id={`spark-${wallet.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <RealSparkline walletId={wallet.id} values={result.values} color={color} />
      </svg>
    </div>
  );
}

function EmptySparkline({ status }: { status: 'unavailable' | 'error' }) {
  const label = status === 'error'
    ? 'Balance history could not be loaded'
    : 'Balance history unavailable';

  return (
    <div
      className="h-8 w-full mt-2 flex items-center justify-center opacity-30"
      role="img"
      aria-label={label}
    >
      <span
        aria-hidden="true"
        className="text-sanctuary-400 dark:text-sanctuary-600 tracking-[0.3em]"
      >
        •••
      </span>
    </div>
  );
}

function RealSparkline({
  walletId,
  values,
  color,
}: {
  walletId: string;
  values: SparklineValues;
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

function sparklinePath(values: SparklineValues): string {
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

function sparklineAreaPath(values: SparklineValues): string {
  const line = sparklinePath(values);
  return `${line} L100,30 L0,30 Z`;
}
