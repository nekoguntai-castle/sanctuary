import React from 'react';
import { useNavigate } from 'react-router-dom';
import { isMultisigType } from '../../../types';
import { getWalletIcon } from '../../ui/CustomIcons';
import type { WalletInfo } from '../hooks/useDeviceData';

interface DetailsTabProps {
  wallets: WalletInfo[];
}

export const DetailsTab: React.FC<DetailsTabProps> = ({ wallets }) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
         <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Associated Wallets</h3>
         {wallets.length === 0 ? (
             <div className="surface-elevated rounded-lg p-8 text-center text-sanctuary-400 border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                 No wallets are currently using this device.
             </div>
         ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {wallets.map(w => {
                     const isMultisig = isMultisigType(w.type);
                     const badgeClass = isMultisig
                        ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                        : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

                     return (
                        <div
                            key={w.id}
                            onClick={() => navigate(`/wallets/${w.id}`)}
                            className="group cursor-pointer surface-elevated p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800 hover:border-sanctuary-400 dark:hover:border-sanctuary-600 transition-all"
                        >
                            <div className="flex items-center justify-between mb-2">
                                 <div className="flex items-center space-x-3">
                                     <div className="p-2 surface-secondary rounded-lg text-sanctuary-500">
                                         {getWalletIcon(w.type, "w-5 h-5")}
                                     </div>
                                     <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{w.name}</span>
                                 </div>
                                 <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${badgeClass}`}>
                                     {isMultisig ? 'Multisig' : 'Single Sig'}
                                 </span>
                            </div>
                            <div className="text-sm text-sanctuary-500 pl-10">
                                ID: {w.id}
                            </div>
                        </div>
                     );
                 })}
             </div>
         )}
    </div>
  );
};
