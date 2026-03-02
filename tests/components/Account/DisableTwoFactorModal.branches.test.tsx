import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DisableTwoFactorModal } from '../../../components/Account/DisableTwoFactorModal';

const buildProps = (
  overrides: Partial<React.ComponentProps<typeof DisableTwoFactorModal>> = {}
) => ({
  disablePassword: 'password123',
  disableToken: 'ABC123',
  twoFactorError: null,
  is2FALoading: false,
  onDisablePasswordChange: vi.fn(),
  onDisableTokenChange: vi.fn(),
  onDisable: vi.fn(),
  onClose: vi.fn(),
  ...overrides,
});

describe('DisableTwoFactorModal branch coverage', () => {
  it('covers error rendering and disable button guard branches', () => {
    const props = buildProps({
      disablePassword: '',
      disableToken: 'AB12',
      twoFactorError: 'Invalid code',
    });

    const { rerender } = render(<DisableTwoFactorModal {...props} />);

    expect(screen.getByText('Invalid code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable 2FA' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: 'ab-12$xy9' } });
    expect(props.onDisableTokenChange).toHaveBeenCalledWith('AB12XY9');

    const enabledProps = buildProps({
      disablePassword: 'password123',
      disableToken: 'ABCDEF',
      twoFactorError: null,
    });
    rerender(<DisableTwoFactorModal {...enabledProps} />);

    expect(screen.queryByText('Invalid code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable 2FA' })).toBeEnabled();
  });
});
