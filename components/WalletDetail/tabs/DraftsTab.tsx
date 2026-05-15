/**
 * DraftsTab - Draft transactions management
 *
 * Renders the DraftList component with wallet context and manages
 * app notification updates when draft counts change.
 */

import React from 'react';
import { DraftList } from '../../DraftList';
import type { WalletType, Address, Quorum } from '../../../types';
import { getQuorumM, getQuorumN } from '../../../types';
import { canEditWalletRole } from '../../../utils/walletCapabilities';

interface DraftsTabProps {
  walletId: string;
  walletType: WalletType;
  quorum?: Quorum | number;
  totalSigners?: number;
  userRole: string;
  addresses: Address[];
  walletName: string;
  onDraftsChange: (count: number) => void;
}

export const DraftsTab: React.FC<DraftsTabProps> = ({
  walletId,
  walletType,
  quorum,
  totalSigners,
  userRole,
  addresses,
  walletName,
  onDraftsChange,
}) => {
  return (
    <div className="surface-elevated rounded-xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
      <DraftList
        walletId={walletId}
        walletType={walletType}
        quorum={quorum ? { m: getQuorumM(quorum), n: getQuorumN(quorum, totalSigners) } : undefined}
        canEdit={canEditWalletRole(userRole)}
        walletAddresses={addresses}
        walletName={walletName}
        onDraftsChange={onDraftsChange}
      />
    </div>
  );
};
