import { describe, expect, it } from 'vitest';
import {
  adminNavGroup,
  appNavItems,
  appRedirectRoutes,
  appRouteDefinitions,
  getNavItemsBySection,
  getRequiredNavItem,
} from '../../../src/app/appRoutes';

describe('app route manifest', () => {
  it('keeps every static nav item backed by a registered route', () => {
    const routePaths = new Set(appRouteDefinitions.map((route) => route.path));

    expect(appNavItems.map((item) => item.to)).toEqual([
      '/',
      '/wallets',
      '/devices',
      '/account',
      '/settings',
      '/intelligence',
      '/admin/node-config',
      '/admin/settings',
      '/admin/variables',
      '/admin/users-groups',
      '/admin/backup',
      '/admin/audit-logs',
      '/admin/ai',
      '/admin/monitoring',
      '/admin/feature-flags',
    ]);
    expect(appNavItems.every((item) => routePaths.has(item.to))).toBe(true);
  });

  it('defines sidebar sections and redirect routes in one place', () => {
    expect(getNavItemsBySection('primary').map((item) => ({
      id: item.id,
      to: item.to,
      requiredCapabilities: item.requiredCapabilities ?? [],
    }))).toEqual([
      { id: 'dashboard', to: '/', requiredCapabilities: [] },
      { id: 'intelligence', to: '/intelligence', requiredCapabilities: ['intelligence'] },
    ]);

    expect(getNavItemsBySection('admin').map((item) => item.label)).toEqual([
      'Node Config',
      'System Settings',
      'Variables',
      'Users & Groups',
      'Backup & Restore',
      'Audit Logs',
      'AI Assistant',
      'Monitoring',
      'Feature Flags',
    ]);

    expect(getRequiredNavItem('wallets')).toMatchObject({
      to: '/wallets',
      label: 'Wallets',
      section: 'wallets',
    });
    expect(getRequiredNavItem('devices')).toMatchObject({
      to: '/devices',
      label: 'Devices',
      section: 'hardware',
    });
    expect(adminNavGroup).toMatchObject({
      to: '/admin',
      label: 'Administration',
    });
    expect(appRedirectRoutes).toEqual([
      { path: '/admin', to: '/admin/settings', replace: true },
      { path: '*', to: '/', replace: true },
    ]);
  });

  it('fails loudly when a required nav item is missing', () => {
    expect(() => getRequiredNavItem('missing-route')).toThrow('Missing nav item: missing-route');
  });
});
