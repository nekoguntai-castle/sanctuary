import React from 'react';
import { Button } from '../ui/Button';
import { Users, Plus, Trash2, Edit2, Info } from 'lucide-react';
import { AdminGroup } from '../../src/api/admin';

interface GroupPanelProps {
  groups: AdminGroup[];
  newGroup: string;
  isCreatingGroup: boolean;
  onNewGroupChange: (value: string) => void;
  onCreateGroup: () => void;
  onEditGroup: (group: AdminGroup) => void;
  onDeleteGroup: (group: AdminGroup) => void;
}

/**
 * Displays the group list panel with inline create form and actions
 * for editing and deleting groups.
 */
export const GroupPanel: React.FC<GroupPanelProps> = ({
  groups,
  newGroup,
  isCreatingGroup,
  onNewGroupChange,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
}) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 text-sanctuary-900 dark:text-sanctuary-100">
        <Users className="w-5 h-5" />
        <h3 className="text-lg font-medium">Groups</h3>
      </div>

      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <div className="p-4 surface-secondary border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex space-x-2">
            <input
              type="text"
              value={newGroup}
              onChange={(e) => onNewGroupChange(e.target.value)}
              placeholder="New group name"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 surface-elevated focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
              onKeyDown={(e) => e.key === 'Enter' && onCreateGroup()}
            />
            <Button size="sm" onClick={onCreateGroup} disabled={!newGroup || isCreatingGroup} isLoading={isCreatingGroup}>
              <Plus className="w-4 h-4 mr-2" /> Create
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs text-sanctuary-500 dark:text-sanctuary-400">
            <Info className="w-3.5 h-3.5 flex-shrink-0" />
            <span>You are not automatically added to groups you create. Add yourself as a member to see wallets shared with the group.</span>
          </div>
        </div>
        <ul className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800 max-h-96 overflow-y-auto">
          {groups.length === 0 ? (
            <li className="p-8 text-center text-sanctuary-400">No groups found</li>
          ) : groups.map(g => (
            <li key={g.id} className="p-4 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-sm">{g.name}</h4>
                <div className="flex items-center space-x-2">
                  <span className="text-xs surface-secondary px-2 py-0.5 rounded text-sanctuary-600 dark:text-sanctuary-400">
                    {g.members.length} Members
                  </span>
                  <button
                    onClick={() => onEditGroup(g)}
                    className="p-1 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors"
                    title="Edit group"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDeleteGroup(g)}
                    className="p-1 text-sanctuary-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    title="Delete group"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {g.members.length === 0 ? (
                  <span className="text-[10px] text-sanctuary-400 italic">No members</span>
                ) : g.members.map(member => (
                  <span key={member.userId} className="text-[10px] px-1.5 py-0.5 border border-sanctuary-200 dark:border-sanctuary-700 rounded text-sanctuary-500">
                    {member.username} {member.role === 'admin' && '(admin)'}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
