import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DraftActions } from '../../../../../components/send/steps/review/DraftActions';

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
});
