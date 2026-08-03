export const mapTrezorSigningError = (message: string): string => {
  if (message.includes('Cancelled') || message.includes('cancelled') || message.includes('rejected')) {
    return 'Transaction rejected on Trezor. Please approve the transaction on your device.';
  }
  if (message.includes('PIN')) {
    return 'Incorrect PIN. Please try again.';
  }
  if (message.includes('Passphrase')) {
    return 'Passphrase entry cancelled.';
  }
  if (message.includes('Device disconnected') || message.includes('no device')) {
    return 'Trezor disconnected. Please reconnect and try again.';
  }
  if (message.includes('Forbidden key path')) {
    return 'Trezor blocked this derivation path. In Trezor Suite, go to Settings > Device > Safety Checks and set to "Prompt" to allow multisig signing.';
  }
  if (message.includes('wrong derivation path') || message.includes('Wrong derivation path')) {
    return 'The derivation path does not match your Trezor account. Please ensure: ' +
      '(1) You are using the same passphrase (or no passphrase) as when you registered the device, and ' +
      '(2) In Trezor Suite, go to Settings > Device > Safety Checks and set to "Prompt" to allow non-standard paths.';
  }

  return `Failed to sign with Trezor: ${message}`;
};
