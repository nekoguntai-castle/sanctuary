import React from 'react';
import type { AppNavItem } from '../../../src/app/appRoutes';
import { NavItem } from '../NavItem';

export const SidebarPrimaryNav: React.FC<{ items: AppNavItem[] }> = ({ items }) => (
  <>
    {items.map((item) => (
      <NavItem key={item.id} to={item.to} icon={item.icon} label={item.label} />
    ))}
  </>
);
