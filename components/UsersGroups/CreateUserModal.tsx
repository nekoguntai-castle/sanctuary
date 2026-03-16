import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { X, Eye, EyeOff } from 'lucide-react';
import { Toggle } from '../ui/Toggle';
import { PasswordRequirements } from './PasswordRequirements';

interface CreateUserModalProps {
  isOpen: boolean;
  isCreating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (data: { username: string; password: string; email: string; isAdmin: boolean }) => void;
}

/**
 * Modal dialog for creating a new user with username, password,
 * email, and admin privilege fields.
 */
export const CreateUserModal: React.FC<CreateUserModalProps> = ({
  isOpen,
  isCreating,
  error,
  onClose,
  onCreate,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  const handleCreate = () => {
    onCreate({ username, password, email, isAdmin });
  };

  const handleClose = () => {
    setUsername('');
    setPassword('');
    setEmail('');
    setIsAdmin(false);
    setShowPassword(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={handleClose}>
      <div className="surface-elevated rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Create New User</h3>
          <button onClick={handleClose} className="text-sanctuary-400 hover:text-sanctuary-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg text-sm text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username *</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Password *</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
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
            <PasswordRequirements password={password} />
          </div>

          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="flex items-center">
            <Toggle checked={isAdmin} onChange={setIsAdmin} color="warning" />
            <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">Administrator privileges</span>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <Button variant="secondary" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleCreate} isLoading={isCreating} disabled={!username || !password}>
            Create User
          </Button>
        </div>
      </div>
    </div>
  );
};
