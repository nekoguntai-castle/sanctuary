import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { X } from 'lucide-react';
import { AdminUser, AdminGroup } from '../../src/api/admin';

interface EditGroupModalProps {
  group: AdminGroup | null;
  users: AdminUser[];
  isUpdating: boolean;
  error: string | null;
  onClose: () => void;
  onUpdate: (data: { name: string; memberIds: string[] }) => void;
}

/**
 * Modal dialog for editing an existing group's name and members.
 */
export const EditGroupModal: React.FC<EditGroupModalProps> = ({
  group,
  users,
  isUpdating,
  error,
  onClose,
  onUpdate,
}) => {
  const [groupName, setGroupName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);

  // Populate form when group changes
  useEffect(() => {
    if (group) {
      setGroupName(group.name);
      setMemberIds(group.members.map(m => m.userId));
    }
  }, [group]);

  if (!group) return null;

  const toggleMember = (userId: string) => {
    setMemberIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleUpdate = () => {
    onUpdate({ name: groupName, memberIds });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="surface-elevated rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Edit Group</h3>
          <button onClick={onClose} className="text-sanctuary-400 hover:text-sanctuary-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Group Name</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">Members</label>
            <div className="max-h-48 overflow-y-auto border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg">
              {users.length === 0 ? (
                <p className="p-3 text-sm text-sanctuary-400 text-center">No users available</p>
              ) : (
                users.map(user => (
                  <label
                    key={user.id}
                    className="flex items-center p-3 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 cursor-pointer border-b border-sanctuary-100 dark:border-sanctuary-800 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={memberIds.includes(user.id)}
                      onChange={() => toggleMember(user.id)}
                      className="w-4 h-4 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">{user.username}</span>
                    {user.isAdmin && (
                      <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">(admin)</span>
                    )}
                  </label>
                ))
              )}
            </div>
            <p className="mt-1 text-xs text-sanctuary-400">
              {memberIds.length} member{memberIds.length !== 1 ? 's' : ''} selected
            </p>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleUpdate} isLoading={isUpdating} disabled={!groupName.trim()}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
};
