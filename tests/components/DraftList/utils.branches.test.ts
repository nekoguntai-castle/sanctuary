import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import {
formatDate,
getExpirationInfo,
getFeeWarning,
getFlowPreviewData,
isExpired,
} from '../../../src/components/DraftList/utils';
import type { DraftTransaction } from '../../../src/api/drafts';

const makeDraft = (overrides: Partial<DraftTransaction> = {}): DraftTransaction => ({
  id: 'draft-1',
  walletId: 'wallet-1',
  userId: 'user-1',
  recipient: 'bc1qrecipient',
  amount: 50000,
  feeRate: 10,
  selectedUtxoIds: ['utxo-1'],
  enableRBF: true,
  subtractFees: false,
  sendMax: false,
  isRBF: false,
  outputs: [{ address: 'bc1qrecipient', amount: 50000 }],
  inputs: [{ txid: 'prev-tx', vout: 0, address: 'bc1qinput', amount: 60000 }],
  decoyOutputs: [],
  psbtBase64: 'cHNidP8=',
  fee: 1000,
  totalInput: 60000,
  totalOutput: 59000,
  changeAmount: 9000,
  changeAddress: 'bc1qchange',
  effectiveAmount: 50000,
  inputPaths: [],
  status: 'unsigned',
  signedDeviceIds: [],
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  ...overrides,
});

describe('DraftList utils branches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('covers expiration thresholds from missing/expired through normal urgency', () => {
    expect(getExpirationInfo(undefined)).toBeNull();
    expect(getExpirationInfo('2026-02-28T23:59:00.000Z')).toMatchObject({
      text: 'Expired',
      urgency: 'expired',
    });
    expect(getExpirationInfo('2026-03-01T00:30:00.000Z')).toMatchObject({
      text: 'Expires in 30m',
      urgency: 'critical',
    });
    expect(getExpirationInfo('2026-03-01T05:00:00.000Z')).toMatchObject({
      text: 'Expires in 5h',
      urgency: 'critical',
    });
    expect(getExpirationInfo('2026-03-02T06:00:00.000Z')).toMatchObject({
      text: 'Expires tomorrow',
      urgency: 'warning',
    });
    expect(getExpirationInfo('2026-03-03T01:00:00.000Z')).toMatchObject({
      text: 'Expires in 2 days',
      urgency: 'warning',
    });
    expect(getExpirationInfo('2026-03-05T00:00:00.000Z')).toMatchObject({
      text: 'Expires in 4 days',
      urgency: 'normal',
    });
  });

  it('covers all fee warning thresholds and non-positive fee/amount guard', () => {
    expect(getFeeWarning(makeDraft({ effectiveAmount: 0, fee: 100 }))).toBeNull();
    expect(getFeeWarning(makeDraft({ effectiveAmount: 1000, fee: 0 }))).toBeNull();

    expect(getFeeWarning(makeDraft({ effectiveAmount: 10000, fee: 5000 }))).toMatchObject({
      level: 'critical',
      message: 'Fee is more than half of the amount!',
    });
    expect(getFeeWarning(makeDraft({ effectiveAmount: 10000, fee: 2500 }))).toMatchObject({
      level: 'critical',
      message: 'Fee is more than 25% of the amount',
    });
    expect(getFeeWarning(makeDraft({ effectiveAmount: 10000, fee: 1000 }))).toMatchObject({
      level: 'warning',
      message: 'Fee is more than 10% of the amount',
    });
    expect(getFeeWarning(makeDraft({ effectiveAmount: 10000, fee: 500 }))).toBeNull();
  });

  it('builds flow preview using explicit inputs/outputs with sendMax and decoys', () => {
    const draft = makeDraft({
      inputs: [
        { txid: 'in-1', vout: 0, address: 'bc1qin1', amount: 30000 },
        { txid: 'in-2', vout: 1, address: 'bc1qin2', amount: 40000 },
      ],
      outputs: [
        { address: 'bc1qout1', amount: 10000 },
        { address: 'bc1qout2', amount: 20000, sendMax: true },
      ],
      effectiveAmount: 77777,
      decoyOutputs: [{ address: 'bc1qdecoy', amount: 1234 }],
    });

    const getAddressLabel = (address: string) => {
      if (address === 'bc1qin1') return 'Input 1';
      if (address === 'bc1qout1') return 'Output 1';
      if (address === 'bc1qdecoy') return 'Decoy';
      return undefined;
    };

    const flow = getFlowPreviewData(draft, getAddressLabel);

    expect(flow.inputs).toHaveLength(2);
    expect(flow.inputs[0].label).toBe('Input 1');
    expect(flow.outputs).toHaveLength(3);
    expect(flow.outputs[0]).toMatchObject({ address: 'bc1qout1', amount: 10000, isChange: false, label: 'Output 1' });
    expect(flow.outputs[1]).toMatchObject({ address: 'bc1qout2', amount: 77777, isChange: false });
    expect(flow.outputs[2]).toMatchObject({ address: 'bc1qdecoy', amount: 1234, isChange: true, label: 'Decoy' });
  });

  it('uses fallback input/output and appends change output when no decoys exist', () => {
    const draft = makeDraft({
      inputs: undefined,
      outputs: undefined,
      decoyOutputs: [],
      selectedUtxoIds: ['u1', 'u2', 'u3'],
      recipient: 'bc1qrecipient-fallback',
      effectiveAmount: 42000,
      changeAmount: 8000,
      changeAddress: 'bc1qchange-fallback',
    });

    const flow = getFlowPreviewData(draft, address => (address === 'bc1qchange-fallback' ? 'Change Label' : undefined));

    expect(flow.inputs[0]).toMatchObject({
      txid: 'inputs',
      address: '3 inputs',
      amount: draft.totalInput,
    });
    expect(flow.outputs[0]).toMatchObject({
      address: 'bc1qrecipient-fallback',
      amount: 42000,
      isChange: false,
    });
    expect(flow.outputs[1]).toMatchObject({
      address: 'bc1qchange-fallback',
      amount: 8000,
      isChange: true,
      label: 'Change Label',
    });
  });

  it('uses singular fallback input text and skips change output when change branch is not eligible', () => {
    const draft = makeDraft({
      inputs: undefined,
      outputs: undefined,
      decoyOutputs: undefined,
      selectedUtxoIds: [],
      changeAmount: 0,
      changeAddress: undefined,
    });

    const flow = getFlowPreviewData(draft, () => undefined);

    expect(flow.inputs).toHaveLength(1);
    expect(flow.inputs[0].address).toBe('1 input');
    expect(flow.outputs).toHaveLength(1);
    expect(flow.outputs[0].isChange).toBe(false);
  });

  it('checks expired helper and returns formatted date text', () => {
    expect(isExpired(makeDraft({ expiresAt: '2026-02-28T00:00:00.000Z' }))).toBe(true);
    expect(isExpired(makeDraft({ expiresAt: '2026-03-02T00:00:00.000Z' }))).toBe(false);
    expect(isExpired(makeDraft({ expiresAt: undefined }))).toBe(false);

    const formatted = formatDate('2026-03-01T10:15:00.000Z');
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
});
