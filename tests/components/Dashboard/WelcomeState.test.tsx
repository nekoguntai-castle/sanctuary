import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WelcomeState } from '../../../components/Dashboard/WelcomeState';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

describe('WelcomeState', () => {
  it('renders heading, description, and create wallet link', () => {
    render(<WelcomeState />);

    expect(screen.getByText('Welcome to Sanctuary')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Your self-hosted Bitcoin wallet coordinator/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create Your First Wallet' }),
    ).toHaveAttribute('href', '/wallets/create');
  });
});
