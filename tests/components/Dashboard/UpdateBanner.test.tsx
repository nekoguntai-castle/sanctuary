import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from '../../../components/Dashboard/UpdateBanner';

vi.mock('lucide-react', () => ({
  Download: () => <span data-testid="download-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

const baseVersionInfo = {
  currentVersion: '1.0.0',
  latestVersion: '1.1.0',
  updateAvailable: true,
  releaseUrl: 'https://codeberg.org/example/releases/v1.1.0',
  releaseName: 'Big Update',
  publishedAt: '2026-01-01',
  releaseNotes: 'Some notes',
  prerelease: false,
};

describe('UpdateBanner', () => {
  it('renders the latest version and current version', () => {
    render(<UpdateBanner versionInfo={baseVersionInfo} onDismiss={vi.fn()} />);

    expect(screen.getByText('Update Available: v1.1.0')).toBeInTheDocument();
    expect(screen.getByText(/You're running v1\.0\.0/)).toBeInTheDocument();
  });

  it('shows release name when present', () => {
    render(<UpdateBanner versionInfo={baseVersionInfo} onDismiss={vi.fn()} />);

    expect(screen.getByText(/Big Update/)).toBeInTheDocument();
  });

  it('omits release name when not present', () => {
    const infoWithoutName = { ...baseVersionInfo, releaseName: '' };
    render(<UpdateBanner versionInfo={infoWithoutName} onDismiss={vi.fn()} />);

    expect(screen.queryByText(/\u2022/)).not.toBeInTheDocument();
  });

  it('links to the release URL', () => {
    render(<UpdateBanner versionInfo={baseVersionInfo} onDismiss={vi.fn()} />);

    const link = screen.getByText('View Release');
    expect(link).toHaveAttribute('href', baseVersionInfo.releaseUrl);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<UpdateBanner versionInfo={baseVersionInfo} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTitle('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
