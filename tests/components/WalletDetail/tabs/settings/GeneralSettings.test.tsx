import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneralSettings } from '../../../../../components/WalletDetail/tabs/settings/GeneralSettings';
import { WalletType } from '../../../../../types';

vi.mock('../../../../../components/LabelManager', () => ({
  LabelManager: ({ walletId }: { walletId: string }) => (
    <div data-testid="label-manager">{walletId}</div>
  ),
}));

const baseWallet = {
  id: 'wallet-1',
  name: 'My Wallet',
  type: WalletType.SINGLE_SIG,
  balance: 100_000,
  canEdit: true,
  userRole: 'owner',
} as any;

const defaultProps = {
  wallet: baseWallet,
  isEditingName: false,
  editedName: '',
  onSetIsEditingName: vi.fn(),
  onSetEditedName: vi.fn(),
  onUpdateWallet: vi.fn(),
  onLabelsChange: vi.fn(),
};

const renderComponent = (overrides: Partial<typeof defaultProps> = {}) =>
  render(<GeneralSettings {...defaultProps} {...overrides} />);

describe('GeneralSettings', () => {
  it('renders wallet name in display mode', () => {
    renderComponent();
    expect(screen.getByText('My Wallet')).toBeInTheDocument();
    expect(screen.getByTitle('Rename wallet')).toBeInTheDocument();
  });

  it('hides rename button when canEdit is false', () => {
    renderComponent({ wallet: { ...baseWallet, canEdit: false } });
    expect(screen.queryByTitle('Rename wallet')).not.toBeInTheDocument();
  });

  it('enters edit mode when rename button is clicked', () => {
    const onSetEditedName = vi.fn();
    const onSetIsEditingName = vi.fn();
    renderComponent({ onSetEditedName, onSetIsEditingName });

    fireEvent.click(screen.getByTitle('Rename wallet'));
    expect(onSetEditedName).toHaveBeenCalledWith('My Wallet');
    expect(onSetIsEditingName).toHaveBeenCalledWith(true);
  });

  it('renders input in editing mode', () => {
    renderComponent({ isEditingName: true, editedName: 'New Name' });
    expect(screen.getByDisplayValue('New Name')).toBeInTheDocument();
  });

  it('saves name when confirm button is clicked', () => {
    const onUpdateWallet = vi.fn();
    const onSetIsEditingName = vi.fn();
    renderComponent({
      isEditingName: true,
      editedName: 'Updated',
      onUpdateWallet,
      onSetIsEditingName,
    });

    // There are two buttons in edit mode - find the save (Check) button
    const buttons = screen.getAllByRole('button');
    // First button is the save button
    fireEvent.click(buttons[0]);
    expect(onUpdateWallet).toHaveBeenCalledWith({ name: 'Updated' });
    expect(onSetIsEditingName).toHaveBeenCalledWith(false);
  });

  it('does not save when name is empty', () => {
    const onUpdateWallet = vi.fn();
    renderComponent({
      isEditingName: true,
      editedName: '   ',
      onUpdateWallet,
    });

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(onUpdateWallet).not.toHaveBeenCalled();
  });

  it('cancels editing when cancel button is clicked', () => {
    const onSetIsEditingName = vi.fn();
    const onSetEditedName = vi.fn();
    renderComponent({
      isEditingName: true,
      editedName: 'Changed',
      onSetIsEditingName,
      onSetEditedName,
    });

    // Second button is the cancel button
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    expect(onSetIsEditingName).toHaveBeenCalledWith(false);
    expect(onSetEditedName).toHaveBeenCalledWith('My Wallet');
  });

  it('saves on Enter key', () => {
    const onUpdateWallet = vi.fn();
    const onSetIsEditingName = vi.fn();
    renderComponent({
      isEditingName: true,
      editedName: 'EnterSave',
      onUpdateWallet,
      onSetIsEditingName,
    });

    fireEvent.keyDown(screen.getByDisplayValue('EnterSave'), { key: 'Enter' });
    expect(onUpdateWallet).toHaveBeenCalledWith({ name: 'EnterSave' });
    expect(onSetIsEditingName).toHaveBeenCalledWith(false);
  });

  it('cancels on Escape key', () => {
    const onSetIsEditingName = vi.fn();
    const onSetEditedName = vi.fn();
    renderComponent({
      isEditingName: true,
      editedName: 'Escaping',
      onSetIsEditingName,
      onSetEditedName,
    });

    fireEvent.keyDown(screen.getByDisplayValue('Escaping'), { key: 'Escape' });
    expect(onSetIsEditingName).toHaveBeenCalledWith(false);
    expect(onSetEditedName).toHaveBeenCalledWith('My Wallet');
  });

  it('renders LabelManager when canEdit is true', () => {
    renderComponent();
    expect(screen.getByTestId('label-manager')).toBeInTheDocument();
  });

  it('hides LabelManager when canEdit is false', () => {
    renderComponent({ wallet: { ...baseWallet, canEdit: false } });
    expect(screen.queryByTestId('label-manager')).not.toBeInTheDocument();
  });

  it('calls onSetEditedName when input value changes', () => {
    const onSetEditedName = vi.fn();
    renderComponent({
      isEditingName: true,
      editedName: 'Old',
      onSetEditedName,
    });

    fireEvent.change(screen.getByDisplayValue('Old'), { target: { value: 'New' } });
    expect(onSetEditedName).toHaveBeenCalledWith('New');
  });
});
