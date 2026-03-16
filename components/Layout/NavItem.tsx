import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { NavItemProps } from './types';

export const NavItem: React.FC<NavItemProps> = ({
  to,
  icon: Icon,
  label,
  hasSubmenu = false,
  isOpen = false,
  onToggle
}) => {
  const location = useLocation();
  const isActive = to === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(to);

  return (
    <div className={`group flex items-center justify-between px-3 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${isActive ? 'bg-primary-50 dark:bg-sanctuary-800 border-l-[3px] border-primary-600 dark:border-primary-500 pl-[9px]' : 'hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 border-l-[3px] border-transparent pl-[9px]'} text-sanctuary-600 dark:text-sanctuary-400 focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-1`}>
      <Link
        to={to}
        className={`flex-1 flex items-center outline-none ${isActive ? 'text-primary-700 dark:text-primary-500 font-semibold' : ''}`}
      >
        <Icon className={`mr-3 h-5 w-5 transition-colors ${isActive ? 'text-primary-600 dark:text-primary-500' : 'text-sanctuary-400 dark:text-sanctuary-500'}`} />
        {label}
      </Link>
      {hasSubmenu && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onToggle) onToggle(e);
          }}
          className="p-1 rounded-md hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
};
