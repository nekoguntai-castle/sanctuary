import React from 'react';
import { Users, X } from 'lucide-react';
import type { DeviceShareGroup, DeviceShareUser } from './accessSectionData';

interface SharedGroupRowProps {
  group: DeviceShareGroup;
  isOwner: boolean;
  sharingLoading: boolean;
  onRemoveGroup: () => void;
}

const SharedGroupRow: React.FC<SharedGroupRowProps> = ({
  group,
  isOwner,
  sharingLoading,
  onRemoveGroup,
}) => (
  <div className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
    <div className="flex items-center">
      <Users className="w-4 h-4 text-sanctuary-500 mr-2" />
      <span className="text-sm font-medium">{group.name}</span>
      <span className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full">
        Viewer
      </span>
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
  shareUser: DeviceShareUser;
  isOwner: boolean;
  sharingLoading: boolean;
  onRemoveUserAccess: (userId: string) => void;
}

const SharedUserRow: React.FC<SharedUserRowProps> = ({
  shareUser,
  isOwner,
  sharingLoading,
  onRemoveUserAccess,
}) => (
  <div className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
    <div className="flex items-center">
      <div className="h-6 w-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
        {shareUser.username.charAt(0).toUpperCase()}
      </div>
      <span className="text-sm font-medium">{shareUser.username}</span>
      <span className="ml-2 text-xs text-sanctuary-500 capitalize">{shareUser.role}</span>
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
  group: DeviceShareGroup | null | undefined;
  sharedUsers: DeviceShareUser[];
  hasSharedAccess: boolean;
  isOwner: boolean;
  sharingLoading: boolean;
  onRemoveGroup: () => void;
  onRemoveUserAccess: (userId: string) => void;
}

export const SharedAccessList: React.FC<SharedAccessListProps> = ({
  group,
  sharedUsers,
  hasSharedAccess,
  isOwner,
  sharingLoading,
  onRemoveGroup,
  onRemoveUserAccess,
}) => (
  <div className="space-y-2">
    {group && (
      <SharedGroupRow
        group={group}
        isOwner={isOwner}
        sharingLoading={sharingLoading}
        onRemoveGroup={onRemoveGroup}
      />
    )}
    {sharedUsers.map((shareUser) => (
      <SharedUserRow
        key={shareUser.id}
        shareUser={shareUser}
        isOwner={isOwner}
        sharingLoading={sharingLoading}
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
