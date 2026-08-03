import React from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  color?: "primary" | "success" | "warning";
  ariaLabel?: string;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  thumbClassName?: string;
}

const activeColors = {
  primary: "bg-primary-600",
  success: "bg-success-500",
  warning: "bg-amber-500",
};

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  color = "primary",
  ariaLabel,
  className = "",
  activeClassName,
  inactiveClassName,
  thumbClassName,
}) => {
  const activeClass = activeClassName ?? activeColors[color];
  const inactiveClass =
    inactiveClassName ?? "bg-sanctuary-300 dark:bg-sanctuary-700";
  const thumbSurfaceClass =
    thumbClassName ?? "bg-white shadow dark:bg-sanctuary-900 dark:ring-1 dark:ring-sanctuary-600";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-sanctuary-950 ${
        checked ? activeClass : inactiveClass
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        } ${thumbSurfaceClass}`}
      />
    </button>
  );
};
