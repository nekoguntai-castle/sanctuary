export function formatWalletType(type: string): string {
  return type === 'multi_sig' ? 'Multisig' : type === 'single_sig' ? 'Single sig' : type;
}

export function formatLimit(value: string | null): string {
  if (!value) return 'No cap';
  try {
    return `${BigInt(value).toLocaleString()} sats`;
  } catch {
    return `${value} sats`;
  }
}

export function formatAlertLimit(value: string | null): string {
  if (!value) return 'Off';
  return formatLimit(value);
}

export function formatNumberLimit(value: number | null, suffix: string): string {
  if (!value) return 'Off';
  return `${value.toLocaleString()} ${suffix}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}
