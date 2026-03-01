import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { X, Eye, EyeOff } from 'lucide-react';
import { AdminUser } from '../../src/api/admin';
import { PasswordRequirements } from './PasswordRequirements';

interface EditUserModalProps {
  user: AdminUser | null;
  isUpdating: boolean;
  error: string | null;
  onClose: () => void;
  onUpdate: (data: { username: string; password: string; email: string; isAdmin: boolean }) => void;
}

/**
 * Modal dialog for editing an existing user's username, password,
 * email, and admin status.
 */
export const EditUserModal: React.FC<EditUserModalProps> = ({
  user,
  isUpdating,
  error,
  onClose,
  onUpdate,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Populate form when user changes
  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setEmail(user.email || '');
      setIsAdmin(user.isAdmin);
      setPassword('');
      setShowPassword(false);
    }
  }, [user]);

  if (!user) return null;

  const handleUpdate = () => {
    onUpdate({ username, password, email, isAdmin });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="surface-elevated rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Edit User: {user.username}</h3>
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
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">New Password (leave blank to keep current)</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full px-3 py-2 pr-10 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-sanctuary-400 hover:text-sanctuary-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {/* Password Requirements - shown when entering new password */}
            {password && <PasswordRequirements password={password} />}
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setIsAdmin(!isAdmin)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${isAdmin ? 'bg-amber-500' : 'bg-sanctuary-300 dark:bg-sanctuary-700'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${isAdmin ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">Administrator privileges</span>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleUpdate} isLoading={isUpdating}>
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
};
