import { render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { SubNavItem } from '../../../src/components/Layout/SubNavItem';

const routerState = vi.hoisted(() => ({ pathname: '/initial' }));

vi.mock('react-router-dom', () => ({
  Link: ({ to, className, title, children }: any) => (
    <a data-testid="link" data-to={to} className={className} title={title}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: routerState.pathname }),
}));

vi.mock('../../../src/components/NotificationBadge', () => ({
  NotificationBadge: ({ count, severity }: any) => (
    <span data-testid="badge">
      {severity}:{count}
    </span>
  ),
}));

describe('SubNavItem branch coverage', () => {
  beforeEach(() => {
    routerState.pathname = '/initial';
  });

  it('renders active state with explicit severity and icon', () => {
    routerState.pathname = '/wallets/1';

    render(
      <SubNavItem
        to="/wallets/1"
        label="Wallet 1"
        icon={<span data-testid="icon">I</span>}
        activeColorClass="text-success-700"
        badgeCount={3}
        badgeSeverity="critical"
      />
    );

    const link = screen.getByTestId('link');
    expect(link.className).toContain('text-success-700');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByTestId('badge')).toHaveTextContent('critical:3');
  });

  it('covers icon-absent path and default warning badge severity', () => {
    routerState.pathname = '/somewhere-else';

    render(
      <SubNavItem
        to="/wallets/2"
        label="Wallet 2"
        badgeCount={2}
      />
    );

    expect(screen.queryByTestId('icon')).not.toBeInTheDocument();
    expect(screen.getByTestId('badge')).toHaveTextContent('warning:2');
  });
});
