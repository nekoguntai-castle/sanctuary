import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportPackageCard } from '../../components/SystemSettings/SupportPackageCard';
import * as supportPackageApi from '../../src/api/admin/supportPackage';

vi.mock('../../src/api/admin/supportPackage', () => ({
  downloadSupportPackage: vi.fn(),
}));

describe('SupportPackageCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('discloses exact exclusions, aggregate activity risk, and old-package risk', () => {
    render(<SupportPackageCard />);

    expect(screen.getByText(/excludes identities, wallet and transaction data/i)).toBeInTheDocument();
    expect(screen.getByText(/aggregate counts and coarse activity windows/i)).toBeInTheDocument();
    expect(screen.getByText(/version 0.8.56 are not safe to share/i)).toBeInTheDocument();
  });

  it('requires informed confirmation before download', async () => {
    const user = userEvent.setup();
    render(<SupportPackageCard />);
    const button = screen.getByRole('button', { name: /Download Support Package/i });
    expect(button).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    await user.click(button);

    expect(supportPackageApi.downloadSupportPackage).toHaveBeenCalledOnce();
  });

  it('shows a fixed error and permits retry', async () => {
    vi.mocked(supportPackageApi.downloadSupportPackage).mockRejectedValue(new Error('private error'));
    const user = userEvent.setup();
    render(<SupportPackageCard />);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Download Support Package/i }));

    expect(await screen.findByText(
      'The privacy-safe support package could not be generated.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/private error/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download Support Package/i })).toBeEnabled();
  });
});
