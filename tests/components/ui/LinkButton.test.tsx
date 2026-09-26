import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Button } from '../../../src/components/ui/Button';
import { LinkButton } from '../../../src/components/ui/LinkButton';

describe('LinkButton', () => {
  it('keeps ghost link and action styling equal while preserving navigation semantics', () => {
    render(
      <MemoryRouter>
        <Button variant="ghost" size="sm">Cancel action</Button>
        <LinkButton variant="ghost" size="sm" to="/wallets/wallet-1?tab=addresses">
          Return to addresses
        </LinkButton>
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: 'Return to addresses' });
    expect(link.className).toBe(screen.getByRole('button', { name: 'Cancel action' }).className);
    expect(link).toHaveAttribute('href', '/wallets/wallet-1?tab=addresses');
    expect(link.tabIndex).toBe(0);
  });

  it('renders a small secondary link by default', () => {
    render(
      <MemoryRouter>
        <LinkButton to="/wallets/wallet-1">Review Drafts</LinkButton>
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: 'Review Drafts' });
    expect(link).toHaveAttribute('href', '/wallets/wallet-1');
    expect(link).toHaveClass('bg-white');
    expect(link).toHaveClass('text-sanctuary-700');
    expect(link).toHaveClass('px-3');
    expect(link).toHaveClass('text-sm');
  });

  it('applies custom button styling and forwards link props', () => {
    render(
      <MemoryRouter>
        <LinkButton
          to={{ pathname: '/wallets/wallet-1', search: '?tab=drafts' }}
          variant="primary"
          size="lg"
          className="dashboard-action"
          data-testid="agent-wallet-link"
          aria-label="Open agent funding wallet"
        >
          Open
        </LinkButton>
      </MemoryRouter>
    );

    const link = screen.getByTestId('agent-wallet-link');
    expect(link).toHaveAttribute('href', '/wallets/wallet-1?tab=drafts');
    expect(link).toHaveAccessibleName('Open agent funding wallet');
    expect(link).toHaveClass('bg-primary-600');
    expect(link).toHaveClass('text-white');
    expect(link).toHaveClass('dark:bg-primary-200');
    expect(link).toHaveClass('px-6');
    expect(link).toHaveClass('text-lg');
    expect(link).toHaveClass('dashboard-action');
  });
});
