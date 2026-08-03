import React from 'react';

interface SkeletonProps {
  className?: string;
}

const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
  <div className={`rounded-lg animate-shimmer ${className}`} />
);

/** Dashboard-shaped skeleton matching the actual dashboard layout */
export const DashboardSkeleton: React.FC = () => (
  <div className="space-y-6 animate-fade-in">
    {/* Mempool pressure bar */}
    <div className="flex items-center gap-3 px-1">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-1 flex-1 rounded-full" />
    </div>

    {/* Network tabs */}
    <div className="flex gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-24 rounded-lg" />
      ))}
    </div>

    {/* Block visualizer */}
    <div className="surface-elevated rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-800">
      <Skeleton className="h-4 w-48 mb-3" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="w-28 h-32 flex-shrink-0 rounded-lg" />
        ))}
      </div>
    </div>

    {/* Top Stats Row - 3 cards matching BTC Price / Fee / Node layout */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex justify-between mb-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="w-9 h-9 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-32 mb-3" />
          <div className="flex justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>

    {/* Balance chart card */}
    <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div>
          <Skeleton className="h-3 w-20 mb-2" />
          <Skeleton className="h-7 w-36" />
        </div>
        <div className="flex-1 lg:w-2/3">
          <div className="flex justify-end mb-2">
            <Skeleton className="h-7 w-48 rounded-lg" />
          </div>
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>
    </div>

    {/* Wallet summary */}
    <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
      <Skeleton className="h-5 w-36 mb-6" />
      <Skeleton className="h-4 w-full rounded-full mb-8" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-2.5 h-2.5 rounded-full" />
              <div>
                <Skeleton className="h-4 w-32 mb-1" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>

    {/* Recent activity */}
    <div className="surface-elevated rounded-xl p-6 border border-sanctuary-200 dark:border-sanctuary-800">
      <Skeleton className="h-5 w-32 mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-full" />
              <div>
                <Skeleton className="h-4 w-40 mb-1" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/** Wallet detail page skeleton with header + tabs */
export const WalletDetailSkeleton: React.FC = () => (
  <div className="space-y-6 animate-fade-in">
    {/* Header card */}
    <div className="surface-elevated rounded-xl p-4 border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex flex-wrap gap-1.5 mb-3">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-7 w-32" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
        <div className="flex gap-1">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>
    </div>

    {/* Tab bar */}
    <div className="border-b border-sanctuary-200 dark:border-sanctuary-800 flex gap-8 pb-0">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-20 mb-4" />
      ))}
    </div>

    {/* Content */}
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-8 h-8 rounded-full" />
            <div>
              <Skeleton className="h-4 w-48 mb-1" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  </div>
);

/** Generic list page skeleton (wallets list, devices list) */
export const ListSkeleton: React.FC = () => (
  <div className="space-y-6 animate-fade-in">
    <div className="flex items-center justify-between">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-9 w-28 rounded-lg" />
    </div>
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-6 py-4 border-b border-sanctuary-100 dark:border-sanctuary-800 last:border-0">
          <div className="flex items-center gap-4">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <div>
              <Skeleton className="h-4 w-36 mb-1.5" />
              <Skeleton className="h-3 w-52" />
            </div>
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  </div>
);

/** Settings page skeleton */
export const SettingsSkeleton: React.FC = () => (
  <div className="space-y-6 animate-fade-in">
    <Skeleton className="h-7 w-24" />
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <Skeleton className="h-5 w-40 mb-2" />
        <Skeleton className="h-3 w-64" />
      </div>
      <div className="p-6 space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <div>
              <Skeleton className="h-4 w-32 mb-1" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

export { Skeleton };
