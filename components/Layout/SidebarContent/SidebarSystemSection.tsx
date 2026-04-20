import React from 'react';
import type { AppNavItem } from '../../../src/app/appRoutes';
import { NavItem } from '../NavItem';
import { SubNavItem } from '../SubNavItem';

type NavGroupItem = Omit<AppNavItem, 'section'>;

interface SidebarSystemSectionProps {
  systemNavItems: AppNavItem[];
  adminNavGroup: NavGroupItem;
  adminNavItems: AppNavItem[];
  showAdminSection: boolean;
  isAdminExpanded: boolean;
  onAdminToggle: () => void;
  settingsNavItem: AppNavItem;
  showSettingsNavItem: boolean;
}

const renderSubNavIcon = (Icon: AppNavItem['icon']) => <Icon className="w-3 h-3" />;

const SidebarAdminSection: React.FC<Pick<
  SidebarSystemSectionProps,
  'adminNavGroup' | 'adminNavItems' | 'showAdminSection' | 'isAdminExpanded' | 'onAdminToggle'
>> = ({
  adminNavGroup,
  adminNavItems,
  showAdminSection,
  isAdminExpanded,
  onAdminToggle,
}) => {
  if (!showAdminSection) return null;

  return (
    <div className="space-y-1 pt-2">
      <NavItem
        to={adminNavGroup.to}
        icon={adminNavGroup.icon}
        label={adminNavGroup.label}
        hasSubmenu
        isOpen={isAdminExpanded}
        onToggle={onAdminToggle}
      />
      {isAdminExpanded && (
        <div className="animate-accordion-open space-y-0.5 mb-2 overflow-hidden">
          {adminNavItems.map((item) => (
            <SubNavItem
              key={item.id}
              to={item.to}
              label={item.label}
              icon={renderSubNavIcon(item.icon)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const SidebarSystemSection: React.FC<SidebarSystemSectionProps> = ({
  systemNavItems,
  adminNavGroup,
  adminNavItems,
  showAdminSection,
  isAdminExpanded,
  onAdminToggle,
  settingsNavItem,
  showSettingsNavItem,
}) => (
  <>
    <div className="pt-6 pb-2">
      <div className="px-4 text-xs font-semibold text-sanctuary-400 uppercase tracking-wider">
        System
      </div>
    </div>
    {systemNavItems.map((item) => (
      <NavItem key={item.id} to={item.to} icon={item.icon} label={item.label} />
    ))}
    <SidebarAdminSection
      adminNavGroup={adminNavGroup}
      adminNavItems={adminNavItems}
      showAdminSection={showAdminSection}
      isAdminExpanded={isAdminExpanded}
      onAdminToggle={onAdminToggle}
    />
    {showSettingsNavItem && (
      <NavItem to={settingsNavItem.to} icon={settingsNavItem.icon} label={settingsNavItem.label} />
    )}
  </>
);
