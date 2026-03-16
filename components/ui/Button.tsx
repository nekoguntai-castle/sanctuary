import React from 'react';
import { SanctuarySpinner } from './CustomIcons';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  isLoading = false,
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-lg transition-all duration-200 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    // Primary uses the 'primary' palette (variable driven) in Light Mode.
    // In Dark Mode, we use a muted Sanctuary (Zinc) palette to match the Zen/Sanctuary aesthetic.
    primary: "bg-primary-800 text-white hover:bg-primary-700 dark:bg-sanctuary-800 dark:text-sanctuary-100 dark:hover:bg-sanctuary-700 dark:border dark:border-sanctuary-700 focus:ring-primary-500",
    
    // Secondary uses neutral Sanctuary palette but with Primary border/text on hover
    secondary: "bg-white text-sanctuary-700 border border-sanctuary-200 hover:border-primary-300 hover:text-primary-700 dark:bg-sanctuary-900 dark:text-sanctuary-200 dark:border-sanctuary-700 dark:hover:border-primary-500 dark:hover:text-primary-300",
    
    danger: "bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:hover:bg-rose-900/30",
    
    ghost: "text-sanctuary-500 hover:text-primary-700 hover:bg-sanctuary-100 dark:text-sanctuary-400 dark:hover:text-primary-200 dark:hover:bg-sanctuary-800",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
    lg: "px-6 py-3 text-lg",
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading ? (
        <SanctuarySpinner size="sm" className="mr-2" />
      ) : null}
      {children}
    </button>
  );
};