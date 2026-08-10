import { render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { DraftActions } from '../../../../../src/components/send/steps/review/DraftActions';

describe('DraftActions branch coverage', () => {
  it('renders preparing state when multisig signing has no txData yet', () => {
    render(
      <DraftActions
        isMultiSig={true}
        isDraftMode={false}
        isReadyToSign={true}
        canBroadcast={false}
        txData={null}
        signing={false}
        broadcasting={false}
        savingDraft={false}
        onSign={vi.fn()}
        prevStep={vi.fn()}
      />
    );

    expect(screen.getByText('Preparing...')).toBeInTheDocument();
  });

  it('disables Back while signing owns the review', () => {
    render(
      <DraftActions
        isMultiSig={false}
        isDraftMode={false}
        isReadyToSign={true}
        canBroadcast={false}
        txData={{} as never}
        signing={true}
        broadcasting={false}
        savingDraft={false}
        onSign={vi.fn()}
        prevStep={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('disables Back while draft persistence owns the review', () => {
    render(
      <DraftActions
        isMultiSig={false}
        isDraftMode={false}
        isReadyToSign={true}
        canBroadcast={false}
        txData={{} as never}
        signing={false}
        broadcasting={false}
        savingDraft={true}
        onSign={vi.fn()}
        prevStep={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });
});
