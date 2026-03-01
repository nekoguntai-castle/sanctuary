import React from 'react';
import { Button } from '../ui/Button';
import { Users, UserPlus, Shield, User as UserIcon, Trash2, Edit2 } from 'lucide-react';
import { AdminUser } from '../../src/api/admin';

interface UserPanelProps {
  users: AdminUser[];
  onCreateUser: () => void;
  onEditUser: (user: AdminUser) => void;
  onDeleteUser: (user: AdminUser) => void;
}

/**
 * Displays the user list panel with actions for creating, editing,
 * and deleting users.
 */
export const UserPanel: React.FC<UserPanelProps> = ({
  users,
  onCreateUser,
  onEditUser,
  onDeleteUser,
}) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 text-sanctuary-900 dark:text-sanctuary-100">
          <Users className="w-5 h-5" />
          <h3 className="text-lg font-medium">Users</h3>
        </div>
        <Button size="sm" onClick={onCreateUser}>
          <UserPlus className="w-4 h-4 mr-2" /> Add User
        </Button>
      </div>

      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <ul className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800 max-h-96 overflow-y-auto">
          {users.length === 0 ? (
            <li className="p-8 text-center text-sanctuary-400">No users found</li>
          ) : users.map(u => (
            <li key={u.id} className="p-4 flex items-center justify-between hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-full ${u.isAdmin ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400'}`}>
                  {u.isAdmin ? <Shield className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                </div>
                <div>
                  <p className="font-medium text-sm">{u.username}</p>
                  <p className="text-xs text-sanctuary-400">{u.email || 'No email'}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {u.isAdmin && (
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 px-2 py-1 rounded">
                    Admin
                  </span>
                )}
                <button
                  onClick={() => onEditUser(u)}
                  className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors"
                  title="Edit user"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDeleteUser(u)}
                  className="p-1.5 text-sanctuary-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  title="Delete user"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
