import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoginLogoContainer } from '../../../components/Login/LoginLogoContainer';

describe('LoginLogoContainer', () => {
  it('renders children and glow ring', () => {
    const { container } = render(
      <LoginLogoContainer>
        <span data-testid="child" />
      </LoginLogoContainer>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(container.querySelector('.login-logo-enter')).toBeInTheDocument();
  });
});
