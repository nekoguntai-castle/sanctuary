import React from 'react';

interface SignerSelectionMessageProps {
  accountTypeLabel: string;
}

export const SignerSelectionEmptyState: React.FC<SignerSelectionMessageProps> = ({
  accountTypeLabel,
}) => (
  <div className="text-center py-4">
    <p className="text-sm text-sanctuary-500">
      No devices with {accountTypeLabel} accounts found.
    </p>
    <p className="text-xs text-sanctuary-400 mt-1">
      Connect a new device or add a {accountTypeLabel} derivation path to an existing device.
    </p>
  </div>
);

export const SignerSelectionHint: React.FC<SignerSelectionMessageProps> = ({
  accountTypeLabel,
}) => (
  <div className="text-center text-xs text-sanctuary-400 mt-2">
    Don't see your device? It may need a {accountTypeLabel} derivation path added.
  </div>
);
