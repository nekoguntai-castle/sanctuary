import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lockBodyScroll } from '../../src/utils/bodyScrollLock';
import { PayjoinEducationModal } from '../../src/components/PayjoinEducationModal';
import { PrivacyDetailPanel } from '../../src/components/PrivacyDetailPanel';

vi.mock('../../src/contexts/CurrencyContext', () => ({
  usePriceFreeFormatter: () => ({
    format: (amount: number) => `${amount} sats`,
    unit: 'sats',
  }),
}));

describe('bodyScrollLock', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('ref-counts overlapping scroll locks and restores previous overflow only on final release', () => {
    document.body.style.overflow = 'auto';

    const releaseFirst = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');

    const releaseSecond = lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');

    // Releasing first lock keeps body locked; repeated release is idempotent
    releaseFirst();
    releaseFirst();
    expect(document.body.style.overflow).toBe('hidden');

    // Releasing second lock restores original overflow
    releaseSecond();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('keeps body scroll locked when PrivacyDetailPanel and PayjoinEducationModal overlap', () => {
    const panel = render(
      <PrivacyDetailPanel
        utxo={{ txid: 'a'.repeat(64), vout: 0, amount: 10000, address: 'bc1qtest' }}
        privacyInfo={{
          utxoId: 'u1',
          txid: 'a'.repeat(64),
          vout: 0,
          amount: 10000,
          address: 'bc1qtest',
          score: { score: 80, grade: 'good', factors: [], warnings: [] },
        }}
        onClose={vi.fn()}
      />,
    );
    const modal = render(<PayjoinEducationModal onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');

    // Unmounting one modal must NOT unlock body while the other is still mounted
    modal.unmount();
    expect(document.body.style.overflow).toBe('hidden');

    panel.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
