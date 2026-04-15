export function generateId(prefix = ''): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateTestnetAddress(type: 'p2wpkh' | 'p2sh' | 'p2pkh' = 'p2wpkh'): string {
  const random = Math.random().toString(36).slice(2);
  switch (type) {
    case 'p2wpkh':
      return `tb1q${random.padEnd(38, '0').slice(0, 38)}`;
    case 'p2sh':
      return `2N${random.padEnd(33, '0').slice(0, 33)}`;
    case 'p2pkh':
      return `m${random.padEnd(33, '0').slice(0, 33)}`;
  }
}

export function generateTxid(): string {
  return Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

export function generateFingerprint(): string {
  return Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}
