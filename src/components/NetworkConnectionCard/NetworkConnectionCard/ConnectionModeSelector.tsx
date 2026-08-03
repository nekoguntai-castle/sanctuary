import type React from 'react';
import { Layers, Radio } from 'lucide-react';
import type { ConnectionMode } from '../types';

type ConnectionModeSelectorProps = {
  mode: ConnectionMode;
  onModeChange: (mode: ConnectionMode) => void;
};

export function ConnectionModeSelector({
  mode,
  onModeChange,
}: ConnectionModeSelectorProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-3">Connection Mode</label>
      <div className="flex gap-1 p-1 surface-secondary rounded-lg">
        <ModeButton
          active={mode === 'singleton'}
          icon={<Radio className="w-4 h-4" />}
          label="Singleton"
          onClick={() => onModeChange('singleton')}
        />
        <ModeButton
          active={mode === 'pool'}
          icon={<Layers className="w-4 h-4" />}
          label="Pool"
          onClick={() => onModeChange('pool')}
        />
      </div>
    </div>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
        active
          ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
          : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
