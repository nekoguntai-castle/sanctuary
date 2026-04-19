import React from 'react';
import { Users, X } from 'lucide-react';
import type { WalletShareInfo } from '../../../../src/api/wallets';
import type { WalletAccessRole, WalletShareGroup, WalletShareUser } from './accessTabData';

interface SharedGroupRowProps {
  group: WalletShareGroup;
  isOwner: boolean;
  sharingLoading: boolean;
  onUpdateGroupRole: (role: WalletAccessRole) => void;
  onRemoveGroup: () => void;
}

const SharedGroupRow: React.FC<SharedGroupRowProps> = ({
  group,
  isOwner,
  sharingLoading,
  onUpdateGroupRole,
  onRemoveGroup,
}) => (
  <div className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
    <div className="flex items-center">
      <Users className="w-4 h-4 text-sanctuary-500 mr-2" />
      <span className="text-sm font-medium">{group.name}</span>
      {isOwner ? (
        <select
          value={group.role}
          onChange={(event) => onUpdateGroupRole(event.target.value as WalletAccessRole)}
          disabled={sharingLoading}
          className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full border-none cursor-pointer"
        >
          <option value="viewer">Viewer</option>
          <option value="signer">Signer</option>
        </select>
      ) : (
        <span className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full capitalize">
          {group.role}
        </span>
      )}
    </div>
    {isOwner && (
      <button
        onClick={onRemoveGroup}
        disabled={sharingLoading}
        className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);
interface SharedUserRowProps {
  shareUser: WalletShareUser;
  isOwner: boolean;
  sharingLoading: boolean;
  onShareWithUser: (userId: string, role: WalletAccessRole) => void;
  onRemoveUserAccess: (userId: string) => void;
}

const SharedUserRow: React.FC<SharedUserRowProps> = ({
  shareUser,
  isOwner,
  sharingLoading,
  onShareWithUser,
  onRemoveUserAccess,
}) => (
  <div className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
    <div className="flex items-center">
      <div className="h-6 w-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
        {shareUser.username.charAt(0).toUpperCase()}
      </div>
      <span className="text-sm font-medium">{shareUser.username}</span>
      {isOwner ? (
        <select
          value={shareUser.role}
          onChange={(event) => onShareWithUser(shareUser.id, event.target.value as WalletAccessRole)}
          disabled={sharingLoading}
          className="ml-2 text-xs bg-transparent border-none p-0 text-sanctuary-500 capitalize cursor-pointer"
        >
          <option value="viewer">Viewer</option>
          <option value="signer">Signer</option>
        </select>
      ) : (
        <span className="ml-2 text-xs text-sanctuary-500 capitalize">{shareUser.role}</span>
      )}
    </div>
    {isOwner && (
      <button
        onClick={() => onRemoveUserAccess(shareUser.id)}
        disabled={sharingLoading}
        className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

interface SharedAccessListProps {
  walletShareInfo: WalletShareInfo | null;
  sharedUsers: WalletShareUser[];
  hasSharedAccess: boolean;
  isOwner: boolean;
  sharingLoading: boolean;
  onUpdateGroupRole: (role: WalletAccessRole) => void;
  onRemoveGroup: () => void;
  onShareWithUser: (userId: string, role: WalletAccessRole) => void;
  onRemoveUserAccess: (userId: string) => void;
}

export const SharedAccessList: React.FC<SharedAccessListProps> = ({
  walletShareInfo,
  sharedUsers,
  hasSharedAccess,
  isOwner,
  sharingLoading,
  onUpdateGroupRole,
  onRemoveGroup,
  onShareWithUser,
  onRemoveUserAccess,
}) => (
  <div className="space-y-2">
    {walletShareInfo?.group && (
      <SharedGroupRow
        group={walletShareInfo.group}
        isOwner={isOwner}
        sharingLoading={sharingLoading}
        onUpdateGroupRole={onUpdateGroupRole}
        onRemoveGroup={onRemoveGroup}
      />
    )}
    {sharedUsers.map((shareUser) => (
      <SharedUserRow
        key={shareUser.id}
        shareUser={shareUser}
        isOwner={isOwner}
        sharingLoading={sharingLoading}
        onShareWithUser={onShareWithUser}
        onRemoveUserAccess={onRemoveUserAccess}
      />
    ))}
    {!hasSharedAccess && (
      <div className="text-center py-6 text-sanctuary-400 text-sm">
        Not shared with anyone yet.
      </div>
    )}
  </div>
);
