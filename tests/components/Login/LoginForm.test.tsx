import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginForm } from '../../../components/Login/LoginForm';

vi.mock('../../../components/Login/LoginBackground', () => ({
  LoginBackground: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="login-bg">{children}</div>
  ),
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  SanctuaryLogo: ({ className }: { className: string }) => (
    <svg data-testid="sanctuary-logo" className={className} />
  ),
  SanctuarySpinner: () => <span data-testid="spinner" />,
}));

const defaultProps = {
  darkMode: false,
  isRegisterMode: false,
  username: '',
  password: '',
  email: '',
  apiStatus: 'connected' as const,
  registrationEnabled: true,
  isLoading: false,
  error: null as string | null,
  onUsernameChange: vi.fn(),
  onPasswordChange: vi.fn(),
  onEmailChange: vi.fn(),
  onSubmit: vi.fn(),
  onToggleMode: vi.fn(),
};

const renderForm = (overrides: Partial<typeof defaultProps> = {}) =>
  render(<LoginForm {...defaultProps} {...overrides} />);

describe('LoginForm', () => {
  it('renders login mode with correct title and button', () => {
    renderForm();

    expect(screen.getByText('Sanctuary')).toBeInTheDocument();
    expect(screen.getByText('Sign in to access your digital sanctuary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('renders register mode with correct title and button', () => {
    renderForm({ isRegisterMode: true });

    expect(screen.getByText('Create your digital sanctuary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('shows loading text when isLoading', () => {
    renderForm({ isLoading: true });
    expect(screen.getByRole('button', { name: /Signing in/i })).toBeInTheDocument();
  });

  it('shows register loading text when isLoading in register mode', () => {
    renderForm({ isLoading: true, isRegisterMode: true });
    expect(screen.getByRole('button', { name: /Creating account/i })).toBeInTheDocument();
  });

  it('calls onUsernameChange when username input changes', () => {
    const onUsernameChange = vi.fn();
    renderForm({ onUsernameChange });

    fireEvent.change(screen.getByPlaceholderText('Enter username'), {
      target: { value: 'alice' },
    });
    expect(onUsernameChange).toHaveBeenCalledWith('alice');
  });

  it('calls onPasswordChange when password input changes', () => {
    const onPasswordChange = vi.fn();
    renderForm({ onPasswordChange });

    fireEvent.change(screen.getByPlaceholderText(/••••/), {
      target: { value: 'secret123' },
    });
    expect(onPasswordChange).toHaveBeenCalledWith('secret123');
  });

  it('calls onEmailChange when email input changes in register mode', () => {
    const onEmailChange = vi.fn();
    renderForm({ isRegisterMode: true, onEmailChange });

    fireEvent.change(screen.getByPlaceholderText('your@email.com'), {
      target: { value: 'alice@example.com' },
    });
    expect(onEmailChange).toHaveBeenCalledWith('alice@example.com');
  });

  it('calls onSubmit when form is submitted', () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    renderForm({ onSubmit });

    fireEvent.submit(screen.getByRole('button', { name: 'Sign In' }).closest('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleMode when toggle button is clicked', () => {
    const onToggleMode = vi.fn();
    renderForm({ onToggleMode });

    fireEvent.click(screen.getByText(/Don't have an account/));
    expect(onToggleMode).toHaveBeenCalledTimes(1);
  });

  it('shows "Already have an account" in register mode', () => {
    renderForm({ isRegisterMode: true });
    expect(screen.getByText(/Already have an account/)).toBeInTheDocument();
  });

  it('shows API status indicators', () => {
    const { rerender } = renderForm({ apiStatus: 'connected' });
    expect(screen.getByText(/Connected/)).toBeInTheDocument();

    rerender(<LoginForm {...defaultProps} apiStatus="checking" />);
    expect(screen.getByText(/Connecting/)).toBeInTheDocument();

    rerender(<LoginForm {...defaultProps} apiStatus="error" />);
    expect(screen.getByText(/Error/)).toBeInTheDocument();
  });

  it('shows error alert when error is provided', () => {
    renderForm({ error: 'Invalid credentials' });
    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
  });

  it('hides toggle button when registration is disabled and in login mode', () => {
    renderForm({ registrationEnabled: false, isRegisterMode: false });
    expect(screen.queryByText(/Don't have an account/)).not.toBeInTheDocument();
  });

  it('shows toggle button in register mode even when registration disabled', () => {
    renderForm({ registrationEnabled: false, isRegisterMode: true });
    expect(screen.getByText(/Already have an account/)).toBeInTheDocument();
  });

  it('shows footer text for login mode with registration enabled', () => {
    renderForm();
    expect(screen.getByText('Use existing credentials to sign in')).toBeInTheDocument();
  });

  it('shows footer text for login mode with registration disabled', () => {
    renderForm({ registrationEnabled: false });
    expect(screen.getByText('Contact administrator for account access')).toBeInTheDocument();
  });

  it('shows footer text for register mode', () => {
    renderForm({ isRegisterMode: true });
    expect(screen.getByText('Create a new account to get started')).toBeInTheDocument();
  });

  it('shows password minimum hint in register mode', () => {
    renderForm({ isRegisterMode: true });
    expect(screen.getByText('Minimum 8 characters')).toBeInTheDocument();
  });
});
