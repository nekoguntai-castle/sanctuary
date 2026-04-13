/**
 * Button Component Tests
 *
 * Regression coverage for the `disabled` + `isLoading` prop interaction
 * that LoginForm depends on after the Phase 6 cookie auth migration.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../../components/ui/Button';

describe('Button', () => {
  it('renders children and is enabled by default', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: 'Click me' });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('disables the button when isLoading is true even with disabled={false}', () => {
    // Regression: a prior implementation spread `{...props}` after the
    // computed `disabled` attribute, so a caller passing both
    // `isLoading={true}` and `disabled={false}` would see the button
    // render ENABLED because the spread silently overwrote the
    // computed disabled value. LoginForm hit this after Phase 6 when
    // it started threading `isLoading` (isSubmitting) and `disabled`
    // (isBootLoading) together onto the same button.
    render(
      <Button isLoading={true} disabled={false}>
        Sign In
      </Button>
    );
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled();
  });

  it('disables the button when disabled={true} is passed explicitly', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('stays disabled when both isLoading and disabled are true', () => {
    render(<Button isLoading disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('renders the spinner only when isLoading is true', () => {
    const { container, rerender } = render(<Button>Idle</Button>);
    expect(container.querySelector('svg')).toBeNull();

    rerender(<Button isLoading>Loading</Button>);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('forwards onClick and other props', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} data-testid="cta">
        Go
      </Button>
    );
    const btn = screen.getByTestId('cta');
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
