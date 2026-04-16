# Transaction Broadcasting Implementation

Complete implementation of Bitcoin transaction creation, signing, and broadcasting functionality for Sanctuary wallet.

## Overview

The transaction broadcasting system is now fully implemented with a clean separation between:
1. **Transaction Creation** - UTXO selection and PSBT creation
2. **Transaction Signing** - Hardware wallet integration
3. **Transaction Broadcasting** - Network propagation and database persistence

## Architecture

### Backend Components

#### 1. Transaction Service (`server/src/services/bitcoin/transactionService.ts`)

Core service handling all transaction logic:

**UTXO Selection**
- `selectUTXOs()` - Smart UTXO selection with multiple strategies
- Supports largest-first, smallest-first strategies
- Automatic fee calculation with change handling
- Manual UTXO selection support

**Transaction Creation**
- `createTransaction()` - Creates PSBT for hardware wallet signing
- Validates recipient addresses
- Handles change outputs (configurable dust threshold, default: 546 sats)
- RBF enabled by default
- Returns unsigned PSBT in base64 format

**Broadcasting & Persistence**
- `broadcastAndSave()` - Broadcasts signed transaction and updates database
- Marks spent UTXOs
- Creates transaction record
- Integrates with Electrum network

**Estimation**
- `estimateTransaction()` - Pre-flight cost estimation
- Returns fee, input/output counts, and sufficiency check

#### 2. API Endpoints (`server/src/api/transactions.ts`)

**POST `/api/v1/wallets/:walletId/transactions/create`**
Creates unsigned PSBT for hardware wallet signing

Request:
```json
{
  "recipient": "bc1q...",
  "amount": 100000,
  "feeRate": 10,
  "selectedUtxoIds": ["txid:vout", ...],
  "enableRBF": true,
  "label": "Payment",
  "memo": "Invoice #123"
}
```

Response:
```json
{
  "psbtBase64": "cHNidP8BAH...",
  "fee": 1500,
  "totalInput": 150000,
  "totalOutput": 148500,
  "changeAmount": 48500,
  "changeAddress": "bc1q...",
  "utxos": [
    { "txid": "abc...", "vout": 0 }
  ]
}
```

**POST `/api/v1/wallets/:walletId/transactions/broadcast`**
Broadcasts signed PSBT to network

Request:
```json
{
  "signedPsbtBase64": "cHNidP8BAH...",
  "recipient": "bc1q...",
  "amount": 100000,
  "fee": 1500,
  "label": "Payment",
  "memo": "Invoice #123",
  "utxos": [
    { "txid": "abc...", "vout": 0 }
  ]
}
```

Response:
```json
{
  "txid": "def456...",
  "broadcasted": true
}
```

**POST `/api/v1/wallets/:walletId/transactions/estimate`**
Estimates transaction cost before creating

Request:
```json
{
  "recipient": "bc1q...",
  "amount": 100000,
  "feeRate": 10,
  "selectedUtxoIds": ["txid:vout", ...]
}
```

Response:
```json
{
  "fee": 1500,
  "totalCost": 101500,
  "inputCount": 2,
  "outputCount": 2,
  "changeAmount": 48500,
  "sufficient": true
}
```

### Frontend Components

#### 1. API Client (`src/api/transactions.ts`)

TypeScript functions for all transaction operations:

```typescript
// Create transaction PSBT
const txData = await transactionsApi.createTransaction(walletId, {
  recipient: 'bc1q...',
  amount: 100000,
  feeRate: 10,
  enableRBF: true
});

// Broadcast signed transaction
const result = await transactionsApi.broadcastTransaction(walletId, {
  signedPsbtBase64: signedPsbt,
  recipient: 'bc1q...',
  amount: 100000,
  fee: 1500,
  utxos: txData.utxos
});

// Estimate before creating
const estimate = await transactionsApi.estimateTransaction(walletId, {
  recipient: 'bc1q...',
  amount: 100000,
  feeRate: 10
});
```

#### 2. SendTransaction Component (`components/SendTransaction.tsx`)

Updated to use the new transaction flow:

1. **Create Transaction** - Calls API to create PSBT
2. **Sign with Hardware Wallet** - Uses hardware wallet integration
3. **Broadcast** - Sends signed PSBT to network

The component handles:
- Real-time fee estimation
- Address validation
- Balance checking
- Coin control (manual UTXO selection)
- Hardware wallet integration
- Error handling
- Success confirmation

## Transaction Flow

### Complete User Journey

```
1. User enters recipient and amount
   ↓
2. Frontend validates inputs
   ↓
3. Frontend calls /transactions/create
   ↓
4. Backend selects UTXOs and creates PSBT
   ↓
5. Backend returns unsigned PSBT
   ↓
6. Frontend prompts hardware wallet to sign
   ↓
7. User confirms on hardware device
   ↓
8. Hardware wallet returns signed PSBT
   ↓
9. Frontend calls /transactions/broadcast
   ↓
10. Backend finalizes PSBT and extracts transaction
   ↓
11. Backend broadcasts to Bitcoin network
   ↓
12. Backend marks UTXOs as spent
   ↓
13. Backend saves transaction to database
   ↓
14. Frontend shows success and txid
```

## Features

### UTXO Selection

The system automatically selects the best UTXOs to use:

**Strategies:**
- **Largest First**: Uses largest UTXOs first (default)
- **Smallest First**: Uses smallest UTXOs first
- **Branch and Bound**: Most efficient selection (future)

**Manual Selection:**
Users can manually select specific UTXOs through coin control interface.

### Change Handling

- Automatically creates change output when needed
- Configurable dust threshold (default: 546 sats, see Admin → Variables)
- Uses unused change addresses from wallet
- Falls back to receiving address if no change address available

### Fee Management

- Accurate fee estimation based on transaction size
- Supports all script types (P2PKH, P2SH, P2WPKH, P2TR)
- SegWit discount applied correctly
- RBF enabled by default for fee bumping

### Security

**Hardware Wallet Integration:**
- Private keys never touch the server
- All signing done on hardware device
- User confirms transaction on device screen

**Validation:**
- Address validation before transaction creation
- Balance sufficiency checks
- Permissions verification
- PSBT integrity validation

### Database Persistence

**Transaction Record:**
```typescript
{
  txid: string;
  walletId: string;
  type: 'sent';
  amount: bigint;
  fee: bigint;
  confirmations: 0;
  label?: string;
  memo?: string;
  blockHeight: null;
  blockTime: null;
}
```

**UTXO Marking:**
- Spent UTXOs marked immediately after broadcast
- Prevents double-spending attempts
- Synchronizes with blockchain confirmations

## Error Handling

The system handles various error scenarios:

### UTXO Selection Errors
- **Insufficient funds**: Not enough UTXOs to cover amount + fee
- **No spendable UTXOs**: All UTXOs already spent

### Transaction Creation Errors
- **Invalid address**: Recipient address format invalid
- **Wallet not found**: Wallet ID doesn't exist
- **Permission denied**: User lacks signing permissions

### Signing Errors
- **Hardware wallet disconnected**: Device not connected
- **User rejected**: User declined on device
- **Signing timeout**: Device didn't respond

### Broadcasting Errors
- **Network failure**: Electrum connection issues
- **Transaction rejected**: Invalid transaction (double-spend, etc.)
- **Insufficient fee**: Fee too low for current mempool

## Testing

### Manual Testing Checklist

- [ ] Create transaction with sufficient balance
- [ ] Attempt transaction with insufficient balance
- [ ] Test with invalid recipient address
- [ ] Test with valid recipient address
- [ ] Sign with hardware wallet
- [ ] Test without hardware wallet connected
- [ ] Test with manual UTXO selection
- [ ] Test with automatic UTXO selection
- [ ] Verify change outputs created correctly
- [ ] Verify no change for exact amounts
- [ ] Check RBF signaling in transactions
- [ ] Verify transaction saved to database
- [ ] Verify UTXOs marked as spent
- [ ] Test fee estimation accuracy
- [ ] Verify broadcast to network

### Integration Testing

```typescript
// Example test flow
describe('Transaction Broadcasting', () => {
  it('should create, sign, and broadcast transaction', async () => {
    // 1. Create PSBT
    const txData = await createTransaction(walletId, {
      recipient: testAddress,
      amount: 10000,
      feeRate: 5
    });

    expect(txData.psbtBase64).toBeDefined();
    expect(txData.fee).toBeGreaterThan(0);

    // 2. Sign (mocked hardware wallet)
    const signedPsbt = await mockHardwareWallet.sign(txData.psbtBase64);

    // 3. Broadcast
    const result = await broadcastAndSave(walletId, signedPsbt, {
      recipient: testAddress,
      amount: 10000,
      fee: txData.fee,
      utxos: txData.utxos
    });

    expect(result.broadcasted).toBe(true);
    expect(result.txid).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

## Monitoring & Debugging

### Logging

The system logs important events:

```
[TRANSACTIONS] Create transaction: walletId=abc123, amount=100000
[TRANSACTIONS] Selected 2 UTXOs totaling 150000 sats
[TRANSACTIONS] Created PSBT with fee=1500 sats
[TRANSACTIONS] Broadcast transaction: txid=def456...
[TRANSACTIONS] Marked 2 UTXOs as spent
[TRANSACTIONS] Transaction saved to database
```

### Common Issues

**Transaction not broadcasting:**
- Check Electrum connection
- Verify PSBT is properly signed
- Check mempool policy (fee rate, RBF conflicts)

**Wrong fee calculation:**
- Verify input/output counts
- Check script type detection
- Ensure SegWit discount applied

**Change output issues:**
- Check dust threshold setting (Admin → Variables, default: 546 sats)
- Verify change address derivation
- Ensure change output not below dust threshold

## Future Enhancements

1. **Advanced UTXO Selection**: Implement branch-and-bound algorithm
2. **Fee Bumping UI**: Direct RBF interface from transaction list
3. **Transaction Templates**: Save recipient addresses and amounts
4. **Scheduled Transactions**: Time-delayed broadcasting
5. **Multi-Signature Support**: Coordinate signing for multisig wallets
6. **Lightning Integration**: Open channels, make LN payments
7. **Privacy Features**: CoinJoin integration, PayJoin support
8. **Fee Market Analysis**: Show current mempool state
9. **Mempool Replacement**: Cancel unconfirmed transactions
10. **Watch-Only Wallets**: Create transactions without signing

## Security Considerations

### Best Practices

1. **Always use hardware wallets** for signing
2. **Verify addresses** on device screen
3. **Check amounts carefully** before confirming
4. **Enable RBF** for fee flexibility
5. **Monitor confirmations** after broadcasting

### Risk Mitigation

- **Double-spend protection**: UTXOs marked spent immediately
- **Replay protection**: Network parameter in PSBT
- **Address validation**: Format checked before creation
- **Balance checks**: Prevent insufficient fund broadcasts
- **Signing verification**: PSBT finalization validates signatures

## Performance Optimization

### UTXO Selection
- Indexes on spent status for fast queries
- Sorted queries for efficient selection
- Caching of available UTXO lists

### Database Operations
- Batch UTXO updates
- Transaction with rollback for atomicity
- Async operations where possible

### Network Communication
- Connection pooling for Electrum
- Retry logic for transient failures
- Timeout handling for slow responses

## Conclusion

The transaction broadcasting system is now production-ready with:
- ✅ Complete UTXO selection and management
- ✅ Secure hardware wallet integration
- ✅ Robust error handling
- ✅ Database persistence
- ✅ Network broadcasting
- ✅ Advanced features (RBF, coin control)
- ✅ Comprehensive API

Users can now fully send Bitcoin from their Sanctuary wallets with confidence and security.
