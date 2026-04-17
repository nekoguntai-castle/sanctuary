import React from 'react';
import { SanctuarySpinner } from './CustomIcons';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const baseButtonStyles = "inline-flex items-center justify-center rounded-md transition-all duration-200 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";

const buttonVariants: Record<ButtonVariant, string> = {
  // Primary uses the 'primary' palette (variable driven) in both modes.
  // In Dark Mode (inverted scale), primary-200 is a warm dark tone and primary-900 is near-white.
  primary: "bg-primary-800 text-white hover:bg-primary-700 dark:bg-primary-200 dark:text-primary-900 dark:hover:bg-primary-300 focus:ring-primary-500",

  // Secondary uses neutral Sanctuary palette — subtle border that stays neutral on hover
  secondary: "bg-white text-sanctuary-700 border border-sanctuary-200 hover:border-sanctuary-300 hover:text-sanctuary-900 dark:bg-sanctuary-800 dark:text-sanctuary-300 dark:border-sanctuary-700/50 dark:hover:border-sanctuary-500 dark:hover:text-sanctuary-100",

  danger: "bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:hover:bg-rose-900/30",

  ghost: "text-sanctuary-500 hover:text-primary-700 hover:bg-sanctuary-100 dark:text-sanctuary-400 dark:hover:text-primary-200 dark:hover:bg-sanctuary-800",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-base",
  lg: "px-6 py-3 text-lg",
};

export function getButtonClassName({
  variant = 'primary',
  size = 'md',
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return `${baseButtonStyles} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  isLoading = false,
  // Destructure `disabled` out of props so the `{...props}` spread
  // below cannot overwrite the computed `disabled` attribute. JSX
  // applies attributes left-to-right; an earlier implementation had
  // `disabled={isLoading || props.disabled}` followed by `{...props}`,
  // which meant a caller passing `disabled={false}` alongside
  // `isLoading={true}` would see the button render ENABLED — the
  // spread silently overwrote the computed disabled value. LoginForm
  // hit this after Phase 6 when it started passing both props at once.
  disabled,
  ...props
}) => {
  return (
    <button
      {...props}
      className={getButtonClassName({ variant, size, className })}
      disabled={isLoading || disabled}
    >
      {isLoading ? (
        <SanctuarySpinner size="sm" className="mr-2" />
      ) : null}
      {children}
    </button>
  );
};
