import React from 'react';

interface TransferOptionsFieldsProps {
  message: string;
  keepExistingUsers: boolean;
  onMessageChange: (message: string) => void;
  onKeepExistingUsersChange: (keepExistingUsers: boolean) => void;
}

export const TransferOptionsFields: React.FC<TransferOptionsFieldsProps> = ({
  message,
  keepExistingUsers,
  onMessageChange,
  onKeepExistingUsersChange,
}) => (
  <>
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
        Message (Optional)
      </label>
      <textarea
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        placeholder="Add a note for the recipient..."
        rows={3}
        maxLength={500}
        className="w-full px-4 py-3 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100 resize-none"
      />
      <p className="text-xs text-sanctuary-400 mt-1">{message.length}/500 characters</p>
    </div>

    <div className="flex items-start">
      <input
        type="checkbox"
        id="keepExistingUsers"
        checked={keepExistingUsers}
        onChange={(event) => onKeepExistingUsersChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
      />
      <label htmlFor="keepExistingUsers" className="ml-3">
        <span className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
          Keep existing viewers
        </span>
        <span className="block text-xs text-sanctuary-500 mt-0.5">
          {keepExistingUsers
            ? `You will retain viewer access after the transfer, and other shared users will keep their access.`
            : `All existing access (including yours) will be removed after the transfer.`}
        </span>
      </label>
    </div>
  </>
);
