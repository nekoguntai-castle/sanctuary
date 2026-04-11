import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TwoFactorScreen } from '../../../components/Login/TwoFactorScreen';

vi.mock('../../../components/Login/LoginBackground', () => ({
  LoginBackground: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="login-bg">{children}</div>
  ),
}));

vi.mock('../../../components/Login/LoginLogoContainer', () => ({
  LoginLogoContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="login-logo-container">{children}</div>
  ),
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  SanctuaryShieldLogo: ({ ready }: { ready?: boolean }) => (
    <span data-testid="sanctuary-shield-logo" data-ready={ready} />
  ),
  SanctuarySpinner: () => <span data-testid="spinner" />,
}));

const defaultProps = {
  darkMode: false,
  twoFactorCode: '',
  onTwoFactorCodeChange: vi.fn(),
  twoFactorInputRef: createRef<HTMLInputElement>(),
  isLoading: false,
  error: null as string | null,
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

const renderScreen = (overrides: Partial<typeof defaultProps> = {}) =>
  render(<TwoFactorScreen {...defaultProps} {...overrides} />);

describe('TwoFactorScreen', () => {
  it('renders title and instructions', () => {
    renderScreen();

    expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
    expect(screen.getByText(/Enter the 6-digit code/)).toBeInTheDocument();
  });

  it('renders verification code input', () => {
    renderScreen();

    expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('000000')).toBeInTheDocument();
  });

  it('shows backup code hint', () => {
    renderScreen();
    expect(screen.getByText(/backup code/)).toBeInTheDocument();
  });

  it('disables verify button when code is too short', () => {
    renderScreen({ twoFactorCode: '123' });
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
  });

  it('enables verify button when code is 6+ characters', () => {
    renderScreen({ twoFactorCode: '123456' });
    expect(screen.getByRole('button', { name: 'Verify' })).not.toBeDisabled();
  });

  it('shows loading text when isLoading', () => {
    renderScreen({ isLoading: true, twoFactorCode: '123456' });
    expect(screen.getByRole('button', { name: /Verifying/i })).toBeInTheDocument();
  });

  it('calls onSubmit when form is submitted', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    renderScreen({ onSubmit, twoFactorCode: '123456' });

    fireEvent.submit(screen.getByRole('button', { name: 'Verify' }).closest('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when back button is clicked', () => {
    const onCancel = vi.fn();
    renderScreen({ onCancel });

    fireEvent.click(screen.getByText('Back to login'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('filters input to uppercase alphanumeric and limits to 8 characters', () => {
    const onTwoFactorCodeChange = vi.fn();
    renderScreen({ onTwoFactorCodeChange });

    fireEvent.change(screen.getByPlaceholderText('000000'), {
      target: { value: 'abc!@#123xyz' },
    });
    expect(onTwoFactorCodeChange).toHaveBeenCalledWith('ABC123XY');
  });

  it('shows error alert when error is provided', () => {
    renderScreen({ error: 'Invalid code' });
    expect(screen.getByText('Invalid code')).toBeInTheDocument();
  });

  it('signals ready state when code reaches 6 digits', () => {
    renderScreen({ twoFactorCode: '123456' });
    expect(screen.getByTestId('sanctuary-shield-logo')).toHaveAttribute('data-ready', 'true');
  });

  it('does not signal ready for short codes', () => {
    renderScreen({ twoFactorCode: '123' });
    expect(screen.getByTestId('sanctuary-shield-logo')).toHaveAttribute('data-ready', 'false');
  });
});
