import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { Eye, EyeOff } from 'lucide-react';
import { Toggle } from '../ui/Toggle';
import { PasswordRequirements } from './PasswordRequirements';
import { ModalWrapper } from '../ui/ModalWrapper';

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
    <ModalWrapper title="Create New User" onClose={handleClose}>
      <ErrorAlert message={error} />

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Username *</label>
          <Input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Password *</label>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
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
          <PasswordRequirements password={password} />
        </div>

        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email *</label>
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
        <Button variant="secondary" onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleCreate}
          isLoading={isCreating}
          disabled={!username.trim() || !password.trim() || !email.trim()}
        >
          Create User
        </Button>
      </div>
    </ModalWrapper>
  );
};
