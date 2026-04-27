import React from 'react';
import type { AppNavItem } from '../../../src/app/appRoutes';
import { NavItem } from '../NavItem';

interface SidebarPrimaryNavProps {
  items: AppNavItem[];
  quickActions?: React.ReactNode;
}

export const SidebarPrimaryNav: React.FC<SidebarPrimaryNavProps> = ({ items, quickActions }) => (
  <>
    {items.map((item, index) => (
      <React.Fragment key={item.id}>
        <NavItem to={item.to} icon={item.icon} label={item.label} />
        {index === 0 ? quickActions : null}
      </React.Fragment>
    ))}
  </>
);
