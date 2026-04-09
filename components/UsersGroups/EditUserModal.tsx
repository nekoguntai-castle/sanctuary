import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { Eye, EyeOff } from 'lucide-react';
import { Toggle } from '../ui/Toggle';
import { ModalWrapper } from '../ui/ModalWrapper';
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
    <ModalWrapper title={`Edit User: ${user.username}`} onClose={onClose}>
      <ErrorAlert message={error} />

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username</label>
          <Input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">New Password (leave blank to keep current)</label>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
              className="pr-10"
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
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
          />
        </div>

        <div className="flex items-center">
          <Toggle checked={isAdmin} onChange={setIsAdmin} color="warning" />
          <span className="ml-3 text-sm text-sanctuary-700 dark:text-sanctuary-300">Administrator privileges</span>
        </div>
      </div>

      <div className="flex justify-end space-x-3 mt-6">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleUpdate} isLoading={isUpdating}>
          Save Changes
        </Button>
      </div>
    </ModalWrapper>
  );
};
