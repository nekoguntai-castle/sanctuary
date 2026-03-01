import React from 'react';
import { Button } from '../ui/Button';
import { ServerFormProps } from './types';

export const ServerForm: React.FC<ServerFormProps> = ({
  editingServerId,
  newServer,
  onNewServerChange,
  onSubmit,
  onCancel,
  isLoading,
}) => {
  return (
    <div className="p-4 surface-secondary rounded-lg border border-primary-300 dark:border-primary-700 space-y-3">
      <div className="font-medium text-sm">
        {editingServerId ? 'Edit Server' : 'Add New Server'}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">
            Label
          </label>
          <input
            type="text"
            value={newServer.label}
            onChange={(e) => onNewServerChange({ ...newServer, label: e.target.value })}
            placeholder="My Server"
            className="w-full px-2 py-1.5 text-xs surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">
            Host
          </label>
          <input
            type="text"
            value={newServer.host}
            onChange={(e) => onNewServerChange({ ...newServer, host: e.target.value })}
            placeholder="electrum.example.com"
            className="w-full px-2 py-1.5 text-xs surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">
            Port
          </label>
          <input
            type="number"
            value={newServer.port}
            onChange={(e) =>
              onNewServerChange({ ...newServer, port: parseInt(e.target.value, 10) || 50002 })
            }
            className="w-full px-2 py-1.5 text-xs surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-sanctuary-500 mb-1">
            Protocol
          </label>
          <select
            value={newServer.useSsl ? 'ssl' : 'tcp'}
            onChange={(e) =>
              onNewServerChange({ ...newServer, useSsl: e.target.value === 'ssl' })
            }
            className="w-full px-2 py-1.5 text-xs surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="ssl">SSL</option>
            <option value="tcp">TCP</option>
          </select>
        </div>
      </div>
      <div className="flex space-x-2">
        <Button
          type="button"
          variant="primary"
          onClick={onSubmit}
          isLoading={isLoading}
          className="flex-1 text-xs py-1.5"
        >
          {editingServerId ? 'Update' : 'Add'} Server
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          className="flex-1 text-xs py-1.5"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};
