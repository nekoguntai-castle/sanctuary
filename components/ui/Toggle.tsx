import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: 'primary' | 'success' | 'warning';
}

const activeColors = {
  primary: 'bg-primary-600',
  success: 'bg-success-500',
  warning: 'bg-amber-500',
};

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  color = 'primary',
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
        checked ? activeColors[color] : 'bg-sanctuary-300 dark:bg-sanctuary-700'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-sanctuary-100 shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
};
