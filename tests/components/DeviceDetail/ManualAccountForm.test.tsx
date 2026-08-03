/**
 * ManualAccountForm Component Tests
 *
 * Tests for the manual device account entry form.
 */

import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Plus: () => <span data-testid="plus-icon">+</span>,
  Loader2: () => <span data-testid="loader-icon">Loading</span>,
}));

// Import after mocks
import {
ManualAccountForm,
type ManualAccountData,
} from '../../../src/components/DeviceDetail/ManualAccountForm';

describe('ManualAccountForm', () => {
  const defaultAccount: ManualAccountData = {
    purpose: 'multisig',
    scriptType: 'native_segwit',
    derivationPath: "m/48'/0'/0'/2'",
    xpub: '',
  };

  const defaultProps = {
    account: defaultAccount,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    loading: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render account purpose select', () => {
      render(<ManualAccountForm {...defaultProps} />);

      expect(screen.getByText('Account Purpose')).toBeInTheDocument();
      // Get the first select (purpose)
      const selects = screen.getAllByRole('combobox');
      expect(selects.length).toBeGreaterThanOrEqual(2);
    });

    it('should render address type select', () => {
      render(<ManualAccountForm {...defaultProps} />);

      expect(screen.getByText('Address Type')).toBeInTheDocument();
    });

    it('should render derivation path input', () => {
      render(<ManualAccountForm {...defaultProps} />);

      expect(screen.getByText('Derivation Path')).toBeInTheDocument();
      expect(screen.getByPlaceholderText("m/48'/0'/0'/2'")).toBeInTheDocument();
    });

    it('should render xpub textarea', () => {
      render(<ManualAccountForm {...defaultProps} />);

      expect(screen.getByText('Extended Public Key')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('xpub...')).toBeInTheDocument();
    });

    it('should render submit button', () => {
      render(<ManualAccountForm {...defaultProps} />);

      expect(
        screen.getByRole('button', { name: /add account/i })
      ).toBeInTheDocument();
    });

    it('should show current account values', () => {
      const account: ManualAccountData = {
        purpose: 'single_sig',
        scriptType: 'taproot',
        derivationPath: "m/86'/0'/0'",
        xpub: 'xpub123test',
      };

      render(<ManualAccountForm {...defaultProps} account={account} />);

      expect(screen.getByDisplayValue("m/86'/0'/0'")).toBeInTheDocument();
      expect(screen.getByDisplayValue('xpub123test')).toBeInTheDocument();
    });
  });

  describe('Purpose Selection', () => {
    it('should have multisig as first option', () => {
      render(<ManualAccountForm {...defaultProps} />);

      const purposeSelect = screen.getAllByRole('combobox')[0];
      const options = purposeSelect.querySelectorAll('option');
      expect(options[0]).toHaveValue('multisig');
    });

    it('should call onChange when purpose changes to single_sig', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<ManualAccountForm {...defaultProps} onChange={onChange} />);

      const purposeSelect = screen.getAllByRole('combobox')[0];
      await user.selectOptions(purposeSelect, 'single_sig');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'single_sig',
          // Derivation path should auto-update for native_segwit single_sig
          derivationPath: "m/84'/0'/0'",
        })
      );
    });

    it('should update derivation path to BIP-48 when changing to multisig', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const purposeSelect = screen.getAllByRole('combobox')[0];
      await user.selectOptions(purposeSelect, 'multisig');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'multisig',
          derivationPath: "m/48'/0'/0'/2'", // BIP-48 for multisig native_segwit
        })
      );
    });
  });

  describe('Script Type Selection', () => {
    it('should have all script type options', () => {
      render(<ManualAccountForm {...defaultProps} />);

      expect(screen.getByText('Native SegWit (bc1q...)')).toBeInTheDocument();
      expect(screen.getByText('Taproot (bc1p...)')).toBeInTheDocument();
      expect(screen.getByText('Nested SegWit (3...)')).toBeInTheDocument();
      expect(screen.getByText('Legacy (1...)')).toBeInTheDocument();
    });

    it('should update derivation path when script type changes for single_sig', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      // Get the Address Type select (second select)
      const selects = screen.getAllByRole('combobox');
      const scriptTypeSelect = selects[1];

      await user.selectOptions(scriptTypeSelect, 'taproot');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptType: 'taproot',
          derivationPath: "m/86'/0'/0'", // BIP-86 for taproot
        })
      );
    });

    it('should update derivation path when script type changes for multisig', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<ManualAccountForm {...defaultProps} onChange={onChange} />);

      // Get the Address Type select (second select)
      const selects = screen.getAllByRole('combobox');
      const scriptTypeSelect = selects[1];

      await user.selectOptions(scriptTypeSelect, 'nested_segwit');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptType: 'nested_segwit',
          derivationPath: "m/48'/0'/0'/1'", // BIP-48 script suffix 1 for nested_segwit
        })
      );
    });
  });

  describe('Derivation Path Input', () => {
    it('should call onChange when derivation path is edited', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<ManualAccountForm {...defaultProps} onChange={onChange} />);

      const pathInput = screen.getByPlaceholderText("m/48'/0'/0'/2'");
      await user.clear(pathInput);
      await user.type(pathInput, "m/49'/0'/0'");

      // Check that onChange was called - each keystroke triggers it
      expect(onChange).toHaveBeenCalled();
      // The last onChange call should have the final character added
      // We verify the input received our keystrokes
      expect(onChange.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('XPub Input', () => {
    it('should call onChange when xpub is entered', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<ManualAccountForm {...defaultProps} onChange={onChange} />);

      const xpubInput = screen.getByPlaceholderText('xpub...');
      await user.type(xpubInput, 'xpub6test');

      // onChange is called for each keystroke
      expect(onChange).toHaveBeenCalled();
      // The call count should match the string length
      expect(onChange).toHaveBeenCalledTimes(9); // 'xpub6test'.length
    });
  });

  describe('Submit Button', () => {
    it('should be disabled when xpub is empty', () => {
      render(<ManualAccountForm {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /add account/i });
      expect(submitButton).toBeDisabled();
    });

    it('should be disabled when derivation path is empty', () => {
      const account: ManualAccountData = {
        ...defaultAccount,
        derivationPath: '',
        xpub: 'xpub123',
      };

      render(<ManualAccountForm {...defaultProps} account={account} />);

      const submitButton = screen.getByRole('button', { name: /add account/i });
      expect(submitButton).toBeDisabled();
    });

    it('should be enabled when both xpub and derivation path are provided', () => {
      const account: ManualAccountData = {
        ...defaultAccount,
        xpub: 'xpub123test',
      };

      render(<ManualAccountForm {...defaultProps} account={account} />);

      const submitButton = screen.getByRole('button', { name: /add account/i });
      expect(submitButton).not.toBeDisabled();
    });

    it('should call onSubmit when clicked', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      const account: ManualAccountData = {
        ...defaultAccount,
        xpub: 'xpub123test',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onSubmit={onSubmit} />
      );

      const submitButton = screen.getByRole('button', { name: /add account/i });
      await user.click(submitButton);

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('should show plus icon when not loading', () => {
      const account: ManualAccountData = {
        ...defaultAccount,
        xpub: 'xpub123test',
      };

      render(<ManualAccountForm {...defaultProps} account={account} />);

      expect(screen.getByTestId('plus-icon')).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should disable button when loading', () => {
      const account: ManualAccountData = {
        ...defaultAccount,
        xpub: 'xpub123test',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} loading={true} />
      );

      const submitButton = screen.getByRole('button', { name: /adding/i });
      expect(submitButton).toBeDisabled();
    });

    it('should show loading text when loading', () => {
      const account: ManualAccountData = {
        ...defaultAccount,
        xpub: 'xpub123test',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} loading={true} />
      );

      expect(screen.getByText('Adding...')).toBeInTheDocument();
    });

    it('should show loader icon when loading', () => {
      const account: ManualAccountData = {
        ...defaultAccount,
        xpub: 'xpub123test',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} loading={true} />
      );

      expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
    });
  });

  describe('Derivation Path Auto-Update', () => {
    it('should set BIP-84 path for single_sig native_segwit', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'multisig',
        scriptType: 'native_segwit',
        derivationPath: "m/48'/0'/0'/2'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const purposeSelect = screen.getAllByRole('combobox')[0];
      await user.selectOptions(purposeSelect, 'single_sig');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          derivationPath: "m/84'/0'/0'",
        })
      );
    });

    it('should set BIP-44 path for single_sig legacy', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const selects = screen.getAllByRole('combobox');
      const scriptTypeSelect = selects[1];
      await user.selectOptions(scriptTypeSelect, 'legacy');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          derivationPath: "m/44'/0'/0'",
        })
      );
    });

    it('should set BIP-49 path for single_sig nested_segwit', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const selects = screen.getAllByRole('combobox');
      const scriptTypeSelect = selects[1];
      await user.selectOptions(scriptTypeSelect, 'nested_segwit');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          derivationPath: "m/49'/0'/0'",
        })
      );
    });

    it('should set BIP-48 nested suffix when changing purpose to multisig', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'single_sig',
        scriptType: 'nested_segwit',
        derivationPath: "m/49'/0'/0'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const purposeSelect = screen.getAllByRole('combobox')[0];
      await user.selectOptions(purposeSelect, 'multisig');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'multisig',
          derivationPath: "m/48'/0'/0'/1'",
        })
      );
    });

    it('should set BIP-48 fallback suffix when changing purpose to multisig with taproot', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'single_sig',
        scriptType: 'taproot',
        derivationPath: "m/86'/0'/0'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const purposeSelect = screen.getAllByRole('combobox')[0];
      await user.selectOptions(purposeSelect, 'multisig');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'multisig',
          derivationPath: "m/48'/0'/0'/2'",
        })
      );
    });

    it('should set BIP-86 path when changing purpose to single_sig with taproot', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'multisig',
        scriptType: 'taproot',
        derivationPath: "m/48'/0'/0'/2'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const purposeSelect = screen.getAllByRole('combobox')[0];
      await user.selectOptions(purposeSelect, 'single_sig');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'single_sig',
          derivationPath: "m/86'/0'/0'",
        })
      );
    });

    it('should set BIP-49 path when changing purpose to single_sig with nested_segwit', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'multisig',
        scriptType: 'nested_segwit',
        derivationPath: "m/48'/0'/0'/1'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const purposeSelect = screen.getAllByRole('combobox')[0];
      await user.selectOptions(purposeSelect, 'single_sig');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'single_sig',
          derivationPath: "m/49'/0'/0'",
        })
      );
    });

    it('should set BIP-44 path when changing purpose to single_sig with legacy', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'multisig',
        scriptType: 'legacy',
        derivationPath: "m/48'/0'/0'/2'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const purposeSelect = screen.getAllByRole('combobox')[0];
      await user.selectOptions(purposeSelect, 'single_sig');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'single_sig',
          derivationPath: "m/44'/0'/0'",
        })
      );
    });

    it('should set multisig native suffix when script type changes to native_segwit', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'multisig',
        scriptType: 'taproot',
        derivationPath: "m/48'/0'/0'/2'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const scriptTypeSelect = screen.getAllByRole('combobox')[1];
      await user.selectOptions(scriptTypeSelect, 'native_segwit');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptType: 'native_segwit',
          derivationPath: "m/48'/0'/0'/2'",
        })
      );
    });

    it('should set multisig fallback suffix when script type changes to taproot', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'multisig',
        scriptType: 'nested_segwit',
        derivationPath: "m/48'/0'/0'/1'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const scriptTypeSelect = screen.getAllByRole('combobox')[1];
      await user.selectOptions(scriptTypeSelect, 'taproot');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptType: 'taproot',
          derivationPath: "m/48'/0'/0'/2'",
        })
      );
    });

    it('should set BIP-84 path when script type changes to native_segwit for single_sig', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const account: ManualAccountData = {
        purpose: 'single_sig',
        scriptType: 'taproot',
        derivationPath: "m/86'/0'/0'",
        xpub: '',
      };

      render(
        <ManualAccountForm {...defaultProps} account={account} onChange={onChange} />
      );

      const scriptTypeSelect = screen.getAllByRole('combobox')[1];
      await user.selectOptions(scriptTypeSelect, 'native_segwit');

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
        })
      );
    });
  });
});
