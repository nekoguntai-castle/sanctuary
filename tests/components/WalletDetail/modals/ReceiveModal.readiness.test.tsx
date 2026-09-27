import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiveModal } from '../../../../src/components/WalletDetail/modals/ReceiveModal';
import { useReceiveModalState } from '../../../../src/components/WalletDetail/modals/useReceiveModalState';
import * as api from '../../../../src/api/payjoin';
import { copyToClipboard } from '../../../../src/utils/clipboard';
import type { Address } from '../../../../src/types';

vi.mock('../../../../src/api/payjoin', () => ({
  getPayjoinStatus: vi.fn(), checkPayjoinEligibility: vi.fn(), getPayjoinUri: vi.fn(),
}));
vi.mock('../../../../src/utils/clipboard', () => ({ copyToClipboard: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const addresses: Address[] = ['a', 'b'].map((id, index) => ({
  id, address: `bc1qaddress${id}`, derivationPath: `m/0/${index}`, index,
  balance: 0, isChange: false, used: false,
}));
const props = { walletId: 'w', addresses, onClose: vi.fn(), onNavigateToSettings: vi.fn() };
function uri(address = 'a', amount = '1'): api.PayjoinUriResponse {
  return {
    uri: `bitcoin:bc1qaddress${address}?amount=${amount}&pj=https://example.test/pj`,
    address: `bc1qaddress${address}`, payjoinUrl: 'https://example.test/pj',
  };
}
function qr(container: HTMLElement) {
  return container.querySelector('svg[width="200"][height="200"]');
}
async function openEnabled() {
  const user = userEvent.setup();
  const view = render(<ReceiveModal {...props} />);
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
  await user.click(screen.getByRole('switch'));
  return { user, ...view };
}
async function settle(request: ReturnType<typeof deferred<api.PayjoinUriResponse>>, fails: boolean, value = uri()) {
  await act(async () => {
    if (fails) request.reject(new Error('URI unavailable'));
    else request.resolve(value);
  });
}

describe('Receive payment URI readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(copyToClipboard).mockReset().mockResolvedValue(true);
    vi.mocked(api.getPayjoinStatus).mockReset().mockResolvedValue({ enabled: true, configured: true });
    vi.mocked(api.checkPayjoinEligibility).mockReset().mockResolvedValue({
      eligible: true, status: 'ready', eligibleUtxoCount: 1, totalUtxoCount: 1, reason: null,
    });
    vi.mocked(api.getPayjoinUri).mockReset().mockResolvedValue(uri());
  });

  it.each(['amount', 'address'] as const)('retires the displayed URI and blocks copy on %s change', async change => {
    const { user, container } = await openEnabled();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } });
    await waitFor(() => expect(api.getPayjoinUri).toHaveBeenLastCalledWith('a', { amount: 100_000_000 }));
    await screen.findByText(uri().uri);
    const previousQr = qr(container)!.innerHTML;
    const pending = deferred<api.PayjoinUriResponse>();
    vi.mocked(api.getPayjoinUri).mockReturnValueOnce(pending.promise);
    if (change === 'amount') fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    else await user.selectOptions(screen.getByRole('combobox'), 'b');
    expect(screen.queryByText(uri().uri)).not.toBeInTheDocument();
    expect(screen.getByTitle('Copy')).toBeDisabled();
    await user.click(screen.getByTitle('Copy'));
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(qr(container)).not.toBeInTheDocument();
    const current = change === 'amount' ? uri('a', '2') : uri('b');
    await settle(pending, false, current);
    expect(screen.getByTitle('Copy')).toBeEnabled();
    expect(qr(container)!.innerHTML).not.toBe(previousQr);
    expect(screen.getByText(current.uri)).toBeInTheDocument();
    await user.click(screen.getByTitle('Copy'));
    expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(current.uri);
  });

  it.each([false, true])('disabling a pending generation restores address QR before retired completion (failure=%s)', async fails => {
    const pending = deferred<api.PayjoinUriResponse>();
    vi.mocked(api.getPayjoinUri).mockReturnValueOnce(pending.promise);
    const { user, container } = await openEnabled();
    await user.click(screen.getByRole('switch'));
    expect(qr(container)).toBeInTheDocument();
    expect(screen.getByTitle('Copy')).toBeEnabled();
    await user.click(screen.getByTitle('Copy'));
    expect(copyToClipboard).toHaveBeenCalledWith(addresses[0].address);
    await settle(pending, fails);
    expect(qr(container)).toBeInTheDocument();
    expect(screen.getByText(addresses[0].address)).toBeInTheDocument();
    expect(screen.queryByText(uri().uri)).not.toBeInTheDocument();
  });

  it.each([false, true])('old off/on generation cannot publish or settle the new owner (failure=%s)', async fails => {
    const old = deferred<api.PayjoinUriResponse>();
    const current = deferred<api.PayjoinUriResponse>();
    vi.mocked(api.getPayjoinUri).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { user, container } = await openEnabled();
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('switch'));
    await settle(old, fails);
    expect(screen.getByTitle('Copy')).toBeDisabled();
    expect(qr(container)).not.toBeInTheDocument();
    expect(screen.queryByText(uri().uri)).not.toBeInTheDocument();
    await settle(current, false, uri('a', '2'));
    expect(qr(container)).toBeInTheDocument();
    expect(screen.getByTitle('Copy')).toBeEnabled();
    expect(screen.getByText(uri('a', '2').uri)).toBeInTheDocument();
  });

  it('preserves current plain-address fallback after generation failure', async () => {
    const pending = deferred<api.PayjoinUriResponse>();
    vi.mocked(api.getPayjoinUri).mockReturnValueOnce(pending.promise);
    const { user, container } = await openEnabled();
    await settle(pending, true);
    expect(qr(container)).toBeInTheDocument();
    await user.click(screen.getByTitle('Copy'));
    expect(copyToClipboard).toHaveBeenCalledWith(addresses[0].address);
  });

  it('preserves optional amount and settled disable behavior', async () => {
    const { user, container } = await openEnabled();
    await screen.findByText(uri().uri);
    expect(api.getPayjoinUri).toHaveBeenCalledWith('a', undefined);
    await user.click(screen.getByRole('switch'));
    expect(qr(container)).toBeInTheDocument();
    await user.click(screen.getByTitle('Copy'));
    expect(copyToClipboard).toHaveBeenCalledWith(addresses[0].address);
  });

  it.each([false, true])('unmount retires URI completion without clipboard effects (failure=%s)', async fails => {
    const pending = deferred<api.PayjoinUriResponse>();
    vi.mocked(api.getPayjoinUri).mockReturnValueOnce(pending.promise);
    const view = await openEnabled();
    view.unmount();
    await settle(pending, fails);
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(screen.queryByText('Receive Bitcoin')).not.toBeInTheDocument();
  });

  it('defensively refuses a direct copy handler call during pending generation', async () => {
    // Defense-in-depth contract; user-facing failures are exercised above.
    const pending = deferred<api.PayjoinUriResponse>();
    vi.mocked(api.getPayjoinUri).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useReceiveModalState(props));
    act(() => result.current.setPayjoinEnabled(true));
    await act(async () => result.current.handleCopy());
    expect(copyToClipboard).not.toHaveBeenCalled();
    await settle(pending, false);
    await act(async () => result.current.handleCopy());
    expect(copyToClipboard).toHaveBeenCalledWith(uri().uri);
  });
});
