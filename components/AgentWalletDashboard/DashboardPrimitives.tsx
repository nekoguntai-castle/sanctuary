import { Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-sanctuary-200 bg-white p-4 dark:border-sanctuary-800 dark:bg-sanctuary-900">
      <div className="text-sm text-sanctuary-500 dark:text-sanctuary-400">{label}</div>
      <div className="mt-1 text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-100">{value}</div>
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-sanctuary-500 dark:text-sanctuary-400">{label}</div>
      <div className="truncate text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{value}</div>
    </div>
  );
}

export function WalletLinkBlock({
  label,
  walletId,
  name,
  helper,
}: {
  label: string;
  walletId: string;
  name: string;
  helper: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-sanctuary-100 p-3 dark:border-sanctuary-800">
      <div className="flex items-center gap-2 text-xs text-sanctuary-500 dark:text-sanctuary-400">
        <Wallet className="h-3 w-3" />
        {label}
      </div>
      <Link to={`/wallets/${walletId}`} className="mt-1 block truncate font-medium text-primary-700 hover:text-primary-800 dark:text-primary-300 dark:hover:text-primary-200">
        {name}
      </Link>
      <div className="truncate text-xs text-sanctuary-500 dark:text-sanctuary-400">{helper}</div>
    </div>
  );
}

export function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-sanctuary-500 dark:text-sanctuary-400">{label}</span>
      <span className="text-right font-medium text-sanctuary-800 dark:text-sanctuary-200">{value}</span>
    </div>
  );
}

export function EmptyDetail({ text }: { text: string }) {
  return <div className="text-xs text-sanctuary-500 dark:text-sanctuary-400">{text}</div>;
}
