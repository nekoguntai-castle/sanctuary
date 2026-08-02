/**
 * Tests for the fail-closed SupportPackageCard component.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SupportPackageCard } from '../../components/SystemSettings/SupportPackageCard';
import * as supportPackageApi from '../../src/api/admin/supportPackage';

vi.mock('../../src/api/admin/supportPackage', () => ({
  downloadSupportPackage: vi.fn(),
}));

describe('SupportPackageCard', () => {
  it('accurately explains that privacy-safe downloads are unavailable', () => {
    render(<SupportPackageCard />);

    expect(screen.getByText('Support Package')).toBeInTheDocument();
    expect(
      screen.getByText(/temporarily unavailable while privacy-safe diagnostics are being implemented/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Existing support packages may contain sensitive configuration/i)
    ).toBeInTheDocument();
  });

  it('renders a disabled control that cannot trigger a download', async () => {
    const user = userEvent.setup();
    render(<SupportPackageCard />);

    const button = screen.getByRole('button', { name: /Download Unavailable/i });
    expect(button).toBeDisabled();

    await user.click(button);

    expect(supportPackageApi.downloadSupportPackage).not.toHaveBeenCalled();
  });
});
