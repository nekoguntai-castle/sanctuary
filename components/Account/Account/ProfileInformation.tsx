import { Mail, Shield, UserCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AccountUser } from './types';

export function ProfileInformation({ user }: { user: AccountUser }) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 surface-secondary rounded-lg text-primary-600 dark:text-primary-500">
            <UserCircle className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Profile Information</h3>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <ProfileField label="Username">
          {user?.username}
        </ProfileField>
        <EmailField email={user?.email} />
        <AccountTypeField isAdmin={Boolean(user?.isAdmin)} />
      </div>
    </div>
  );
}

function ProfileField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">{label}</label>
      <div className="px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 font-mono">
        {children}
      </div>
    </div>
  );
}

function EmailField({ email }: { email: string | undefined }) {
  if (!email) return null;

  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Email</label>
      <div className="px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 font-mono flex items-center">
        <Mail className="w-4 h-4 mr-2 text-sanctuary-400" />
        {email}
      </div>
    </div>
  );
}

function AccountTypeField({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">Account Type</label>
      <div className="px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 flex items-center">
        <Shield className={`w-4 h-4 mr-2 ${isAdmin ? 'text-primary-600' : 'text-sanctuary-400'}`} />
        {isAdmin ? 'Administrator' : 'Standard User'}
      </div>
    </div>
  );
}
