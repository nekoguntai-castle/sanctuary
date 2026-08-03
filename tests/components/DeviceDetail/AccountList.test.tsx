/**
 * AccountList Component Tests
 *
 * Tests for the device account list display component.
 */

import { render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import type { DeviceAccount } from '../../../src/types';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Check: () => <span data-testid="check-icon">✓</span>,
}));

// Import after mocks
import { AccountList } from '../../../src/components/DeviceDetail/AccountList';

// Test data
const mockAccounts: DeviceAccount[] = [
  {
    id: 'acc-1',
    purpose: 'single_sig',
    scriptType: 'native_segwit',
    derivationPath: "m/84'/0'/0'",
    xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6h5DyZVz5WHLdkCAa1BEVa1234567890abcdef',
  },
  {
    id: 'acc-2',
    purpose: 'multisig',
    scriptType: 'native_segwit',
    derivationPath: "m/48'/0'/0'/2'",
    xpub: 'xpub6E9Qk6G2ebSoabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJ',
  },
  {
    id: 'acc-3',
    purpose: 'single_sig',
    scriptType: 'taproot',
    derivationPath: "m/86'/0'/0'",
    xpub: 'xpub6BsnM8d8Pwzntest1234567890abcdefghijklmnop',
  },
];

describe('AccountList', () => {
  describe('Empty State', () => {
    it('should display empty state message when no accounts', () => {
      render(<AccountList accounts={[]} />);

      expect(
        screen.getByText('No accounts have been added to this device yet.')
      ).toBeInTheDocument();
    });

    it('should apply custom className to empty state', () => {
      render(<AccountList accounts={[]} className="custom-class" />);

      const emptyState = screen.getByText(
        'No accounts have been added to this device yet.'
      );
      expect(emptyState).toHaveClass('custom-class');
    });
  });

  describe('Account Rendering', () => {
    it('should render all accounts', () => {
      render(<AccountList accounts={mockAccounts} />);

      // Check each account is rendered (by derivation path)
      expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();
      expect(screen.getByText("m/48'/0'/0'/2'")).toBeInTheDocument();
      expect(screen.getByText("m/86'/0'/0'")).toBeInTheDocument();
    });

    it('should display account type title', () => {
      render(<AccountList accounts={mockAccounts} />);

      // Native SegWit single-sig should show BIP-84
      expect(screen.getByText(/Native SegWit.*BIP-84/)).toBeInTheDocument();
      // Multisig Native SegWit should show BIP-48
      expect(screen.getByText(/Multisig.*Native SegWit.*BIP-48/)).toBeInTheDocument();
      // Taproot should show BIP-86
      expect(screen.getByText(/Taproot.*BIP-86/)).toBeInTheDocument();
    });

    it('should display xpub for each account', () => {
      render(<AccountList accounts={mockAccounts} />);

      // XPubs should be displayed (truncated in UI)
      expect(
        screen.getByText(/xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6h5DyZVz5WHLdkCAa1BEVa/)
      ).toBeInTheDocument();
    });

    it('should display derivation path label', () => {
      render(<AccountList accounts={mockAccounts} />);

      // Multiple "Path:" labels
      const pathLabels = screen.getAllByText('Path:');
      expect(pathLabels).toHaveLength(3);
    });

    it('should display XPub label', () => {
      render(<AccountList accounts={mockAccounts} />);

      const xpubLabels = screen.getAllByText('XPub:');
      expect(xpubLabels).toHaveLength(3);
    });

    it('should display Address label', () => {
      render(<AccountList accounts={mockAccounts} />);

      const addressLabels = screen.getAllByText('Address:');
      expect(addressLabels).toHaveLength(3);
    });

    it('should display address prefix for each account type', () => {
      render(<AccountList accounts={mockAccounts} />);

      // bc1q for native segwit
      expect(screen.getAllByText('bc1q...')).toHaveLength(2);
      // bc1p for taproot
      expect(screen.getByText('bc1p...')).toBeInTheDocument();
    });
  });

  describe('Recommended Badge', () => {
    it('should show recommended badge for recommended account types', () => {
      render(<AccountList accounts={mockAccounts} />);

      // Native SegWit single-sig and Multisig Native SegWit are recommended
      const recommendedBadges = screen.getAllByText('Recommended');
      expect(recommendedBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('should show check icon in recommended badge', () => {
      render(<AccountList accounts={mockAccounts} />);

      // At least one check icon for recommended accounts
      const checkIcons = screen.getAllByTestId('check-icon');
      expect(checkIcons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Single Account', () => {
    it('should render single account correctly', () => {
      const singleAccount: DeviceAccount[] = [mockAccounts[0]];
      render(<AccountList accounts={singleAccount} />);

      expect(screen.getByText("m/84'/0'/0'")).toBeInTheDocument();
      expect(screen.getByText(/Native SegWit.*BIP-84/)).toBeInTheDocument();
    });
  });

  describe('Custom className', () => {
    it('should apply custom className to container', () => {
      const { container } = render(
        <AccountList accounts={mockAccounts} className="my-custom-class" />
      );

      const wrapper = container.firstChild;
      expect(wrapper).toHaveClass('my-custom-class');
    });
  });

  describe('Account without ID', () => {
    it('should handle accounts without id using index as key', () => {
      const accountsWithoutId: DeviceAccount[] = [
        {
          id: '',
          purpose: 'single_sig',
          scriptType: 'legacy',
          derivationPath: "m/44'/0'/0'",
          xpub: 'xpub123...',
        },
      ];

      render(<AccountList accounts={accountsWithoutId} />);

      expect(screen.getByText("m/44'/0'/0'")).toBeInTheDocument();
      expect(screen.getByText(/Legacy.*BIP-44/)).toBeInTheDocument();
    });
  });

  describe('Unknown Account Type', () => {
    it('should handle unknown account type combinations', () => {
      const unknownAccount: DeviceAccount[] = [
        {
          id: 'unknown-1',
          purpose: 'multisig',
          scriptType: 'taproot', // multisig:taproot is not configured
          derivationPath: "m/86'/0'/0'/2'",
          xpub: 'xpub456...',
        },
      ];

      render(<AccountList accounts={unknownAccount} />);

      // Should display "Unknown Format" for unconfigured combinations
      expect(screen.getByText('Unknown Format')).toBeInTheDocument();
      // Derivation path appears both as description and in the path field
      const pathElements = screen.getAllByText("m/86'/0'/0'/2'");
      expect(pathElements).toHaveLength(2);
    });
  });

  describe('All Script Types', () => {
    it('should display correct prefixes for all script types', () => {
      const allTypes: DeviceAccount[] = [
        {
          id: '1',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub1...',
        },
        {
          id: '2',
          purpose: 'single_sig',
          scriptType: 'taproot',
          derivationPath: "m/86'/0'/0'",
          xpub: 'xpub2...',
        },
        {
          id: '3',
          purpose: 'single_sig',
          scriptType: 'nested_segwit',
          derivationPath: "m/49'/0'/0'",
          xpub: 'xpub3...',
        },
        {
          id: '4',
          purpose: 'single_sig',
          scriptType: 'legacy',
          derivationPath: "m/44'/0'/0'",
          xpub: 'xpub4...',
        },
      ];

      render(<AccountList accounts={allTypes} />);

      expect(screen.getByText('bc1q...')).toBeInTheDocument(); // native segwit
      expect(screen.getByText('bc1p...')).toBeInTheDocument(); // taproot
      expect(screen.getByText('3...')).toBeInTheDocument(); // nested segwit
      expect(screen.getByText('1...')).toBeInTheDocument(); // legacy
    });
  });
});
