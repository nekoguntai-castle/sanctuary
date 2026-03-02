import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from '../../../components/DeviceList/EmptyState';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('lucide-react', () => ({
  HardDrive: () => <span data-testid="hard-drive-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

describe('DeviceList EmptyState', () => {
  it('navigates to connect device page when primary button is clicked', async () => {
    const user = userEvent.setup();
    render(<EmptyState />);

    await user.click(screen.getByRole('button', { name: /connect your first device/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/devices/connect');
  });
});
