import { expect, it } from 'vitest';
import request from 'supertest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  app,
  mockAuditLogFromRequest,
  mockBroadcastAndSave,
  mockDraftFindByIdInWallet,
  mockEvaluatePolicies,
  mockFindAddressStrings,
  mockFindUtxosByOutpointsForWallet,
  mockWalletFindByIdWithDevices,
  walletId,
} from './transactionsHttpRoutesTestHarness';

const RAW_BROADCAST_INPUT_TXID = 'd'.repeat(64);
const RAW_BROADCAST_INPUT_VOUT = 1;
const RAW_BROADCAST_EXTERNAL_ADDRESS = bitcoin.payments.p2wpkh({
  hash: Buffer.alloc(20, 1),
  network: bitcoin.networks.testnet,
}).address!;
const RAW_BROADCAST_CHANGE_ADDRESS = bitcoin.payments.p2wpkh({
  hash: Buffer.alloc(20, 2),
  network: bitcoin.networks.testnet,
}).address!;

const makeRawBroadcastHex = ({
  externalAddress = RAW_BROADCAST_EXTERNAL_ADDRESS,
  externalAmount = 10000,
  changeAddress = RAW_BROADCAST_CHANGE_ADDRESS,
  changeAmount = 10000,
  includeExternalOutput = true,
  includeChangeOutput = true,
  extraExternalAddress,
  extraExternalAmount = 5000,
  includeUnknownOutput = false,
  unknownOutputAmount = 0,
}: {
  externalAddress?: string;
  externalAmount?: number;
  changeAddress?: string;
  changeAmount?: number;
  includeExternalOutput?: boolean;
  includeChangeOutput?: boolean;
  extraExternalAddress?: string;
  extraExternalAmount?: number;
  includeUnknownOutput?: boolean;
  unknownOutputAmount?: number;
} = {}) => {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(RAW_BROADCAST_INPUT_TXID, 'hex').reverse(), RAW_BROADCAST_INPUT_VOUT);
  if (includeExternalOutput) {
    tx.addOutput(bitcoin.address.toOutputScript(externalAddress, bitcoin.networks.testnet), BigInt(externalAmount));
  }
  if (extraExternalAddress) {
    tx.addOutput(bitcoin.address.toOutputScript(extraExternalAddress, bitcoin.networks.testnet), BigInt(extraExternalAmount));
  }
  if (includeUnknownOutput) {
    tx.addOutput(
      bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from('sanctuary')]),
      BigInt(unknownOutputAmount)
    );
  }
  if (includeChangeOutput) {
    tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(changeAmount));
  }
  return tx.toHex();
};

const makeDuplicateInputRawBroadcastHex = () => {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  const inputHash = Buffer.from(RAW_BROADCAST_INPUT_TXID, 'hex').reverse();
  tx.addInput(inputHash, RAW_BROADCAST_INPUT_VOUT);
  tx.addInput(inputHash, RAW_BROADCAST_INPUT_VOUT);
  tx.addOutput(bitcoin.address.toOutputScript(RAW_BROADCAST_EXTERNAL_ADDRESS, bitcoin.networks.testnet), BigInt(10000));
  tx.addOutput(bitcoin.address.toOutputScript(RAW_BROADCAST_CHANGE_ADDRESS, bitcoin.networks.testnet), BigInt(10000));
  return tx.toHex();
};

const mockRawBroadcastWalletState = ({
  inputAmount = 20150,
  changeAddress = RAW_BROADCAST_CHANGE_ADDRESS,
}: {
  inputAmount?: number;
  changeAddress?: string;
} = {}) => {
  mockFindAddressStrings.mockResolvedValueOnce([changeAddress]);
  mockFindUtxosByOutpointsForWallet.mockResolvedValueOnce([{
    id: 'utxo-raw-1',
    txid: RAW_BROADCAST_INPUT_TXID,
    vout: RAW_BROADCAST_INPUT_VOUT,
    address: changeAddress,
    amount: BigInt(inputAmount),
    spent: false,
    frozen: false,
    draftLock: null,
  }]);
};

const makeBroadcastDraft = (overrides: Record<string, unknown> = {}) => ({
  id: 'draft-1',
  walletId,
  userId: 'test-user-id',
  recipient: 'tb1qdraftrecipient',
  amount: BigInt(12000),
  effectiveAmount: BigInt(12000),
  fee: BigInt(250),
  selectedUtxoIds: [`${'c'.repeat(64)}:1`],
  signedPsbtBase64: 'signed-draft-psbt',
  status: 'signed',
  approvalStatus: 'approved',
  label: 'draft label',
  memo: 'draft memo',
  ...overrides,
});

export function registerTransactionHttpRawBroadcastTests(): void {
  it.each(['ledger', 'jade', 'trezor'])(
    'blocks %s wallet raw broadcast before intent resolution or node submission',
    async type => {
      mockWalletFindByIdWithDevices.mockResolvedValue({
        id: walletId,
        devices: [{ device: { type, model: null } }],
      });

      const response = await request(app)
        .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
        .send({ rawTxHex: makeRawBroadcastHex() });

      expect(response.status).toBe(403);
      expect(response.body.details).toMatchObject({
        vendor: type,
        capability: 'broadcast',
      });
      expect(mockFindUtxosByOutpointsForWallet).not.toHaveBeenCalled();
      expect(mockBroadcastAndSave).not.toHaveBeenCalled();
    },
  );

  it('broadcasts raw transaction and writes audit event', async () => {
    const rawTxHex = makeRawBroadcastHex();
    mockRawBroadcastWalletState();

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        rawTxHex,
        recipient: RAW_BROADCAST_EXTERNAL_ADDRESS,
        amount: 10000,
        fee: 150,
        utxos: [{ txid: RAW_BROADCAST_INPUT_TXID, vout: RAW_BROADCAST_INPUT_VOUT }],
        label: 'hardware wallet send',
        memo: 'coldcard raw hex path',
      });

    expect(response.status).toBe(200);
    expect(response.body.txid).toHaveLength(64);
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(walletId, undefined, {
      network: 'testnet4',
      recipient: RAW_BROADCAST_EXTERNAL_ADDRESS,
      amount: 10000,
      fee: 150,
      label: 'hardware wallet send',
      memo: 'coldcard raw hex path',
      utxos: [{ txid: RAW_BROADCAST_INPUT_TXID, vout: RAW_BROADCAST_INPUT_VOUT }],
      rawTxHex,
      inputs: expect.arrayContaining([
        expect.objectContaining({
          txid: RAW_BROADCAST_INPUT_TXID,
          vout: RAW_BROADCAST_INPUT_VOUT,
          amount: 20150,
        }),
      ]),
      outputs: expect.arrayContaining([
        expect.objectContaining({
          address: RAW_BROADCAST_EXTERNAL_ADDRESS,
          amount: 10000,
          outputType: 'recipient',
          isOurs: false,
        }),
      ]),
    });
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'TRANSACTION_BROADCAST',
      'WALLET',
      expect.objectContaining({ success: true })
    );
  });

  it('derives raw transaction policy metadata when caller metadata is omitted', async () => {
    const rawTxHex = makeRawBroadcastHex({ includeUnknownOutput: true, unknownOutputAmount: 0 });
    mockRawBroadcastWalletState();

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex });

    expect(response.status).toBe(200);
    expect(mockEvaluatePolicies).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: RAW_BROADCAST_EXTERNAL_ADDRESS,
        amount: BigInt(10000),
      })
    );
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      undefined,
      expect.objectContaining({
        recipient: RAW_BROADCAST_EXTERNAL_ADDRESS,
        amount: 10000,
        fee: 150,
        utxos: [{ txid: RAW_BROADCAST_INPUT_TXID, vout: RAW_BROADCAST_INPUT_VOUT }],
        rawTxHex,
        outputs: expect.arrayContaining([
          expect.objectContaining({
            address: '',
            amount: 0,
            outputType: 'unknown',
            isOurs: false,
          }),
        ]),
      })
    );
  });

  it('derives zero-amount policy metadata for change-only raw transactions', async () => {
    const rawTxHex = makeRawBroadcastHex({ externalAmount: 0, changeAmount: 10000 });
    mockRawBroadcastWalletState({ inputAmount: 10150 });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex });

    expect(response.status).toBe(200);
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      undefined,
      expect.objectContaining({
        recipient: RAW_BROADCAST_CHANGE_ADDRESS,
        amount: 0,
        fee: 150,
        outputs: expect.arrayContaining([
          expect.objectContaining({
            address: RAW_BROADCAST_EXTERNAL_ADDRESS,
            amount: 0,
            outputType: 'unknown',
            isOurs: false,
          }),
        ]),
      })
    );
  });

  it('broadcasts raw transaction from a matching draft', async () => {
    const rawTxHex = makeRawBroadcastHex();
    mockRawBroadcastWalletState();
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft({
      recipient: RAW_BROADCAST_EXTERNAL_ADDRESS,
      amount: BigInt(10000),
      effectiveAmount: BigInt(10000),
      fee: BigInt(150),
      selectedUtxoIds: [`${RAW_BROADCAST_INPUT_TXID}:${RAW_BROADCAST_INPUT_VOUT}`],
    }));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex, draftId: 'draft-1' });

    expect(response.status).toBe(200);
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      undefined,
      expect.objectContaining({
        draftId: 'draft-1',
        recipient: RAW_BROADCAST_EXTERNAL_ADDRESS,
        amount: 10000,
        fee: 150,
      })
    );
  });

  it('rejects raw transaction broadcasts when caller metadata contradicts decoded outputs', async () => {
    const rawTxHex = makeRawBroadcastHex();
    mockRawBroadcastWalletState();

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        rawTxHex,
        recipient: RAW_BROADCAST_EXTERNAL_ADDRESS,
        amount: 21000,
      });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'amount',
      reason: 'metadata_mismatch',
      expected: 10000,
      actual: 21000,
    });
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transaction broadcasts when caller fee contradicts decoded inputs', async () => {
    const rawTxHex = makeRawBroadcastHex();
    mockRawBroadcastWalletState();

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        rawTxHex,
        recipient: RAW_BROADCAST_EXTERNAL_ADDRESS,
        amount: 10000,
        fee: 149,
      });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'fee',
      reason: 'metadata_mismatch',
      expected: 150,
      actual: 149,
    });
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transaction broadcasts when caller UTXOs contradict decoded inputs', async () => {
    const rawTxHex = makeRawBroadcastHex();
    mockRawBroadcastWalletState();

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        rawTxHex,
        utxos: [{ txid: 'e'.repeat(64), vout: 0 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'utxos',
      reason: 'metadata_mismatch',
      expected: [`${RAW_BROADCAST_INPUT_TXID}:${RAW_BROADCAST_INPUT_VOUT}`],
      actual: [`${'e'.repeat(64)}:0`],
    });
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transaction broadcasts when draft UTXOs contradict decoded inputs', async () => {
    const rawTxHex = makeRawBroadcastHex();
    mockRawBroadcastWalletState();
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft({
      recipient: RAW_BROADCAST_EXTERNAL_ADDRESS,
      amount: BigInt(10000),
      effectiveAmount: BigInt(10000),
      fee: BigInt(150),
      selectedUtxoIds: [`${'e'.repeat(64)}:0`],
    }));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex, draftId: 'draft-1' });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'draftId',
      reason: 'metadata_mismatch',
      expected: [`${RAW_BROADCAST_INPUT_TXID}:${RAW_BROADCAST_INPUT_VOUT}`],
      actual: [`${'e'.repeat(64)}:0`],
    });
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transaction broadcasts that spend unknown wallet inputs', async () => {
    const rawTxHex = makeRawBroadcastHex();
    mockFindAddressStrings.mockResolvedValueOnce([RAW_BROADCAST_CHANGE_ADDRESS]);
    mockFindUtxosByOutpointsForWallet.mockResolvedValueOnce([]);

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'rawTxHex',
      reason: 'unknown_inputs',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transactions with duplicate inputs', async () => {
    const rawTxHex = makeDuplicateInputRawBroadcastHex();

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'rawTxHex',
      reason: 'duplicate_inputs',
    });
    expect(mockFindUtxosByOutpointsForWallet).not.toHaveBeenCalled();
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transactions that spend inputs locked by another draft', async () => {
    const rawTxHex = makeRawBroadcastHex();
    mockFindAddressStrings.mockResolvedValueOnce([RAW_BROADCAST_CHANGE_ADDRESS]);
    mockFindUtxosByOutpointsForWallet.mockResolvedValueOnce([{
      id: 'utxo-raw-locked',
      txid: RAW_BROADCAST_INPUT_TXID,
      vout: RAW_BROADCAST_INPUT_VOUT,
      address: RAW_BROADCAST_CHANGE_ADDRESS,
      amount: BigInt(20150),
      spent: false,
      frozen: false,
      draftLock: { draftId: 'other-draft' },
    }]);

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex });

    expect(response.status).toBe(409);
    expect(response.body.details).toMatchObject({
      reason: 'utxo_locked',
      txid: RAW_BROADCAST_INPUT_TXID,
      vout: RAW_BROADCAST_INPUT_VOUT,
      draftId: 'other-draft',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transactions with paid non-address outputs', async () => {
    const rawTxHex = makeRawBroadcastHex({ includeUnknownOutput: true, unknownOutputAmount: 1 });
    mockRawBroadcastWalletState();

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'rawTxHex',
      reason: 'unknown_paid_output',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transactions without any standard wallet or recipient output', async () => {
    const rawTxHex = makeRawBroadcastHex({
      includeExternalOutput: false,
      includeChangeOutput: false,
      includeUnknownOutput: true,
      unknownOutputAmount: 0,
    });
    mockRawBroadcastWalletState({ inputAmount: 150 });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'rawTxHex',
      reason: 'missing_standard_outputs',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transactions whose outputs exceed wallet inputs', async () => {
    const rawTxHex = makeRawBroadcastHex();
    mockRawBroadcastWalletState({ inputAmount: 19999 });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'rawTxHex',
      reason: 'negative_fee',
      fee: -1,
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects malformed raw transaction hex before broadcast', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex: 'not-hex' });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'rawTxHex',
      reason: 'invalid_raw_transaction',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects raw transactions with multiple external recipients', async () => {
    const extraExternalAddress = bitcoin.payments.p2wpkh({
      hash: Buffer.alloc(20, 3),
      network: bitcoin.networks.testnet,
    }).address!;
    const rawTxHex = makeRawBroadcastHex({
      extraExternalAddress,
      extraExternalAmount: 5000,
      changeAmount: 5000,
    });
    mockRawBroadcastWalletState();

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'rawTxHex',
      reason: 'multiple_external_recipients',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });
}
