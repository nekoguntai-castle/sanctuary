import React from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { UTXO, Transaction } from '../types';
import { Coins, CalendarClock, DollarSign, Clock } from 'lucide-react';
import { useCurrency } from '../contexts/CurrencyContext';
import { useDelayedRender } from '../hooks/useDelayedRender';

interface WalletStatsProps {
  utxos: UTXO[];
  balance: number;
  transactions?: Transaction[];
}

export const WalletStats: React.FC<WalletStatsProps> = ({ utxos, balance, transactions = [] }) => {
  const { getFiatValue, btcPrice, currencySymbol, fiatCurrency, showFiat, format } = useCurrency();

  // Delay chart render to avoid Recharts dimension warning during initial layout
  const chartReady = useDelayedRender();

  // Calculate Fiat Balance
  const fiatBalance = getFiatValue(balance) ?? 0;

  // Age distribution
  const now = Date.now();
  const day = 86400000;

  const ageData = [
    { name: '< 1m', count: 0, amount: 0 },
    { name: '1-6m', count: 0, amount: 0 },
    { name: '6-12m', count: 0, amount: 0 },
    { name: '> 1y', count: 0, amount: 0 },
  ];

  utxos.forEach(u => {
    const utxoDate = typeof u.date === 'string' ? new Date(u.date).getTime() : (u.date ?? now);
    const age = now - utxoDate;
    if (age < day * 30) { ageData[0].count++; ageData[0].amount += u.amount; }
    else if (age < day * 180) { ageData[1].count++; ageData[1].amount += u.amount; }
    else if (age < day * 365) { ageData[2].count++; ageData[2].amount += u.amount; }
    else { ageData[3].count++; ageData[3].amount += u.amount; }
  });

  // Calculate average UTXO age in days
  const avgUtxoAgeDays = utxos.length > 0
    ? Math.round(utxos.reduce((sum, u) => {
        const utxoDate = typeof u.date === 'string' ? new Date(u.date).getTime() : (u.date ?? now);
        return sum + (now - utxoDate);
      }, 0) / utxos.length / day)
    : 0;

  // Format age display (days, months, or years)
  const formatAge = (days: number) => {
    if (days < 30) return { value: days, unit: 'days' };
    if (days < 365) return { value: Math.round(days / 30), unit: 'months' };
    const years = days / 365;
    if (years >= 2) return { value: Math.round(years), unit: 'years' };
    return { value: parseFloat(years.toFixed(1)), unit: 'years' };
  };

  const ageDisplay = formatAge(avgUtxoAgeDays);

  // Build accumulation history using pre-calculated balanceAfter from transactions
  const buildAccumulationHistory = () => {
    if (transactions.length === 0) {
      return [{ name: 'Now', amount: balance }];
    }

    // Sort transactions oldest to newest, filter to those with balanceAfter
    const sortedTxs = [...transactions]
      .filter(
        (tx): tx is Transaction & { balanceAfter: number; timestamp: number } =>
          tx.balanceAfter != null && tx.timestamp != null
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    if (sortedTxs.length === 0) {
      return [{ name: 'Now', amount: balance }];
    }

    const oldestTx = sortedTxs[0];
    const nowDate = new Date();

    // Calculate time span in days
    const spanDays = Math.ceil((now - oldestTx.timestamp) / day);

    // Determine appropriate date formatting based on time span
    let dateFormat: (d: Date) => string;

    if (spanDays <= 30) {
      dateFormat = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else if (spanDays <= 180) {
      dateFormat = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } else if (spanDays <= 730) {
      dateFormat = (d) => d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    } else {
      dateFormat = (d) => d.getFullYear().toString();
    }

    const dataPoints: { name: string; amount: number; date: Date }[] = [];

    // Add starting point (0 balance before first transaction)
    const startDate = new Date(oldestTx.timestamp);
    startDate.setDate(startDate.getDate() - 1);
    dataPoints.push({
      name: dateFormat(startDate),
      amount: 0,
      date: startDate
    });

    // Use pre-calculated balanceAfter directly from each transaction
    for (const tx of sortedTxs) {
      const txDate = new Date(tx.timestamp);

      dataPoints.push({
        name: dateFormat(txDate),
        amount: tx.balanceAfter!,
        date: txDate
      });
    }

    // Add current point
    const lastBalance = sortedTxs[sortedTxs.length - 1].balanceAfter;
    dataPoints.push({
      name: dateFormat(nowDate),
      amount: lastBalance,
      date: nowDate
    });

    // Remove duplicate dates, keeping the LAST (final) balance for each date
    // This ensures we show the end-of-day balance, not intermediate states
    const dateBalances = new Map<string, typeof dataPoints[0]>();
    for (const point of dataPoints) {
      dateBalances.set(point.name, point);  // Last occurrence wins
    }
    const uniquePoints = Array.from(dateBalances.values());

    return uniquePoints.map(p => ({ name: p.name, amount: p.amount }));
  };

  const accumulationData = buildAccumulationHistory();

  // Calculate oldest transaction date for display
  const oldestTxTimestamp = transactions
    .map(t => t.timestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === 'number');
  const oldestTxDate = oldestTxTimestamp.length > 0
    ? new Date(Math.min(...oldestTxTimestamp))
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="surface-elevated p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
             <div className="flex items-center justify-between mb-2">
                 <span className="text-xs font-medium text-sanctuary-500 uppercase">{showFiat ? `${fiatCurrency} Value` : 'BTC Value'}</span>
                 <DollarSign className="w-4 h-4 text-emerald-500" />
             </div>
             <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                 {showFiat ? 
                    `${currencySymbol}${fiatBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}` :
                    format(balance).split(' (')[0]
                 }
             </div>
             <div className="text-xs text-sanctuary-400 mt-1">
                {showFiat ? (btcPrice !== null ? `@ ${currencySymbol}${btcPrice.toLocaleString()}/BTC` : 'Loading price...') : 'Current Holdings'}
             </div>
          </div>
          
          <div className="surface-elevated p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
             <div className="flex items-center justify-between mb-2">
                 <span className="text-xs font-medium text-sanctuary-500 uppercase">UTXO Count</span>
                 <Coins className="w-4 h-4 text-zen-accent" />
             </div>
             <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                 {utxos.length}
             </div>
             <div className="text-xs text-sanctuary-400 mt-1">Unspent Outputs</div>
          </div>

           <div className="surface-elevated p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
             <div className="flex items-center justify-between mb-2">
                 <span className="text-xs font-medium text-sanctuary-500 uppercase">Avg UTXO Age</span>
                 <CalendarClock className="w-4 h-4 text-blue-400" />
             </div>
             <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                 {utxos.length > 0 ? (
                   <>{ageDisplay.value} <span className="text-sm font-normal text-sanctuary-500">{ageDisplay.unit}</span></>
                 ) : (
                   <span className="text-sm font-normal text-sanctuary-500">No UTXOs</span>
                 )}
             </div>
          </div>

           <div className="surface-elevated p-4 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
             <div className="flex items-center justify-between mb-2">
                 <span className="text-xs font-medium text-sanctuary-500 uppercase">First Activity</span>
                 <Clock className="w-4 h-4 text-sanctuary-400" />
             </div>
             <div className="text-2xl font-bold text-sanctuary-900 dark:text-sanctuary-100">
                 {oldestTxDate ? (
                   oldestTxDate.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
                 ) : (
                   <span className="text-sm font-normal text-sanctuary-500">No transactions</span>
                 )}
             </div>
             {oldestTxDate && (
               <div className="text-xs text-sanctuary-400 mt-1">
                 {Math.round((now - oldestTxDate.getTime()) / day)} days ago
               </div>
             )}
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
           <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-6">Accumulation History</h3>
           <div className="h-64 min-w-[200px]">
             {chartReady && (
               <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                 <AreaChart data={accumulationData}>
                   <defs>
                     <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                       <stop offset="5%" stopColor="#d4b483" stopOpacity={0.3}/>
                       <stop offset="95%" stopColor="#d4b483" stopOpacity={0}/>
                     </linearGradient>
                   </defs>
                   <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#a8a29e'}} />
                   <YAxis hide domain={[0, 'dataMax']} />
                   <Tooltip
                    contentStyle={{ backgroundColor: '#1c1917', border: 'none', borderRadius: '8px', color: '#fff' }}
                    formatter={(value) => [format(value as number), 'Balance']}
                  />
                   <Area type="monotone" dataKey="amount" stroke="#d4b483" strokeWidth={2} fillOpacity={1} fill="url(#colorAmount)" />
                 </AreaChart>
               </ResponsiveContainer>
             )}
           </div>
        </div>

        <div className="surface-elevated p-6 rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
           <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-6">UTXO Age Distribution</h3>
           <div className="h-64 min-w-[200px]">
             {chartReady && (
               <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                 <BarChart data={ageData}>
                   <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#a8a29e'}} />
                   <YAxis hide />
                   <Tooltip
                      cursor={{fill: 'transparent'}}
                      contentStyle={{ backgroundColor: '#1c1917', border: 'none', borderRadius: '8px', color: '#fff' }}
                      formatter={(value) => [format(value as number), 'Amount']}
                   />
                   <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                      {ageData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={['#d4b483', '#84a98c', '#57534e', '#a8a29e'][index % 4]} />
                      ))}
                   </Bar>
                 </BarChart>
               </ResponsiveContainer>
             )}
           </div>
        </div>
      </div>
    </div>
  );
};
