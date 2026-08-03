import { fireEvent,render,screen } from '@testing-library/react';
import React from 'react';
import { describe,expect,it,vi } from 'vitest';
import { AboutModal } from '../../../src/components/Layout/AboutModal';

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <div data-testid="qr-code">{`${value}:${size}`}</div>
  ),
}));

vi.mock('../../../src/components/ui/CustomIcons', () => ({
  SanctuaryLogo: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="logo" {...props} />,
}));

describe('AboutModal branch coverage', () => {
  it('covers update-available and release-name branches plus copied-state branch', () => {
    const onClose = vi.fn();
    const onCopyAddress = vi.fn();

    const { rerender } = render(
      <AboutModal
        show={true}
        onClose={onClose}
        versionLoading={false}
        copiedAddress="btc"
        onCopyAddress={onCopyAddress}
        versionInfo={{
          currentVersion: '0.8.8',
          latestVersion: '0.9.0',
          updateAvailable: true,
          releaseName: 'Hotfix Build',
          releaseUrl: 'https://github.com/nekoguntai-castle/sanctuary/releases/tag/v0.9.0',
        } as any}
      />,
    );

    expect(screen.getByText('Update available: v0.9.0')).toBeInTheDocument();
    expect(screen.getByText('Hotfix Build')).toBeInTheDocument();
    expect(screen.getAllByText('Copied!').length).toBeGreaterThan(0);
    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getAllByTestId('qr-code').length).toBe(3);
    expect(screen.getByRole('link', { name: /GitHub Repository/i })).toHaveAttribute(
      'href',
      'https://github.com/nekoguntai-castle/sanctuary',
    );
    expect(screen.getByRole('link', { name: 'Release Notes' })).toHaveAttribute(
      'href',
      'https://github.com/nekoguntai-castle/sanctuary/releases',
    );
    expect(screen.getByRole('link', { name: /View release notes/i })).toHaveAttribute(
      'href',
      'https://github.com/nekoguntai-castle/sanctuary/releases/tag/v0.9.0',
    );

    // Click the first non-copied donation button and ensure copy callback fires.
    const copyButtons = screen.getAllByRole('button', { name: /Copy|Copied!/i });
    fireEvent.click(copyButtons[1]);
    expect(onCopyAddress).toHaveBeenCalled();

    // Cover releaseName falsy branch while update is still available.
    rerender(
      <AboutModal
        show={true}
        onClose={onClose}
        versionLoading={false}
        copiedAddress={null}
        onCopyAddress={onCopyAddress}
        versionInfo={{
          currentVersion: '0.8.8',
          latestVersion: '0.9.1',
          updateAvailable: true,
          releaseName: '',
          releaseUrl: 'https://github.com/nekoguntai-castle/sanctuary/releases/tag/v0.9.1',
        } as any}
      />,
    );

    expect(screen.getByText('Update available: v0.9.1')).toBeInTheDocument();
    expect(screen.queryByText('Hotfix Build')).not.toBeInTheDocument();
  });
});
