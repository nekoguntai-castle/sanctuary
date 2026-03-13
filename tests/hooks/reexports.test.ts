import { describe,expect,it,vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useSendTransactionActions: vi.fn(),
  useQrScanner: vi.fn(),
}));

vi.mock('../../hooks/send/useSendTransactionActions', () => ({
  useSendTransactionActions: mocks.useSendTransactionActions,
}));

vi.mock('../../hooks/qr/useQrScanner', () => ({
  useQrScanner: mocks.useQrScanner,
}));

import { useQrScanner } from '../../hooks/qr/useQrScanner';
import { useSendTransactionActions } from '../../hooks/send/useSendTransactionActions';

describe('hooks re-export shims', () => {
  it('re-exports useSendTransactionActions', () => {
    expect(useSendTransactionActions).toBe(mocks.useSendTransactionActions);
  });

  it('re-exports useQrScanner', () => {
    expect(useQrScanner).toBe(mocks.useQrScanner);
  });
});
