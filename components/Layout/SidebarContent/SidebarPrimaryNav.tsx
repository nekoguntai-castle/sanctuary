import React from 'react';
import type { AppNavItem } from '../../../src/app/appRoutes';
import { NavItem } from '../NavItem';

interface SidebarPrimaryNavProps {
  items: AppNavItem[];
}

export const SidebarPrimaryNav: React.FC<SidebarPrimaryNavProps> = ({ items }) => (
  <>
    {items.map((item) => (
      <React.Fragment key={item.id}>
        <NavItem to={item.to} icon={item.icon} label={item.label} />
      </React.Fragment>
    ))}
  </>
);
