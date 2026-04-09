import React from 'react';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Styled input field with consistent focus, border, and dark mode styling.
 * Accepts all standard HTML input attributes.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 ${className}`}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
