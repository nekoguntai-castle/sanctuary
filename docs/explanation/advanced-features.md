# Advanced Bitcoin Transaction Features

This document describes the advanced Bitcoin transaction features that are implemented in Sanctuary, including fee management, privacy tools, and advanced send flows.

## Features Implemented

### Advanced Send Flow (Overview)

```
User selects outputs & fee
        │
        ├─ Optional: Coin control + privacy analysis
        │
        ├─ Optional: Decoy change outputs
        │
        ├─ Create PSBT (single or batch)
        │
        ├─ Optional: Payjoin attempt (fallback to normal send)
        │
        ├─ Sign on hardware wallet
        │
        ├─ Broadcast
        │
        └─ Post-send options: RBF fee bump / CPFP acceleration
```

### 1. RBF (Replace-By-Fee)

Replace-By-Fee allows you to speed up stuck transactions by creating a replacement transaction with a higher fee.

#### Backend Implementation
- **File**: `server/src/services/bitcoin/advancedTx.ts`
- **Functions**:
  - `isRBFSignaled(txHex)` - Check if transaction signals RBF
  - `canReplaceTransaction(txid)` - Verify if transaction is replaceable
  - `createRBFTransaction(txid, newFeeRate, walletId)` - Create replacement transaction

#### API Endpoints
- `POST /api/v1/bitcoin/transaction/:txid/rbf-check` - Check RBF status
- `POST /api/v1/bitcoin/transaction/:txid/rbf` - Create RBF transaction

#### Frontend Component
- **File**: `components/TransactionActions.tsx`
- Shows RBF button on unconfirmed outgoing transactions
- Displays current fee rate and minimum new fee rate
- Creates replacement transaction with higher fee

#### How It Works
1. Transaction must be unconfirmed and signal RBF (sequence < 0xfffffffe)
2. New fee rate must be higher than current by at least 1 sat/vB **or** 10% (whichever is greater)
3. Fee increase is deducted from change output
4. Original transaction is replaced in mempool

### 2. CPFP (Child-Pays-For-Parent)

Child-Pays-For-Parent allows you to speed up transactions by spending from them with a higher fee.

#### Backend Implementation
- **Files**:
  - `server/src/services/bitcoin/advancedTx.ts`
  - `server/src/services/bitcoin/transactionService.ts` (wallet-specific batch creation)
- **Functions**:
  - `calculateCPFPFee(parentTxSize, parentFeeRate, childTxSize, targetFeeRate)` - Calculate required child fee
  - `createCPFPTransaction(parentTxid, parentVout, targetFeeRate, recipientAddress, walletId)` - Create child transaction

#### API Endpoints
- `POST /api/v1/bitcoin/transaction/cpfp` - Create CPFP transaction

#### Frontend Component
- **File**: `components/TransactionActions.tsx`
- Shows CPFP button on unconfirmed incoming transactions
- Calculates effective fee rate for parent + child package
- Creates child transaction spending from parent

#### How It Works
1. Creates a new transaction spending an output from the stuck transaction
2. Child transaction pays a higher fee to incentivize mining both transactions
3. Effective fee rate is calculated for the package (parent + child)
4. Miners are incentivized to mine both to get the child's higher fee

### 3. Batch Transactions

Send to multiple recipients in a single transaction, saving significant fees.

#### Backend Implementation
- **File**: `server/src/services/bitcoin/advancedTx.ts`
- **Functions**:
  - `createBatchTransaction(recipients, feeRate, walletId, selectedUtxoIds)` - Create batch transaction
  - Automatically selects UTXOs
  - Calculates fee savings vs individual transactions

#### API Endpoints
- `POST /api/v1/bitcoin/transaction/batch` - Create batch transaction (global bitcoin API)
- `POST /api/v1/wallets/:walletId/transactions/batch` - Create batch transaction scoped to wallet

#### Frontend Component
- **File**: `components/BatchSend.tsx`
- Full UI for batch sending
- Add/remove multiple recipients
- Shows fee comparison and savings
- Displays total cost breakdown

#### How It Works
1. Multiple outputs are combined into a single transaction
2. Significant fee savings (typically 60%+) compared to individual transactions
3. All payments are confirmed together in one block
4. Includes automatic UTXO selection and change output handling

### 4. Advanced Fee Estimation

More granular fee estimation with time predictions.

#### Backend Implementation
- **File**: `server/src/services/bitcoin/advancedTx.ts`
- **Functions**:
  - `getAdvancedFeeEstimates()` - Get fee estimates for 5 priority levels
  - `estimateOptimalFee(inputCount, outputCount, priority, scriptType)` - Calculate optimal fee

#### API Endpoints
- `GET /api/v1/bitcoin/fees/advanced` - Get advanced fee estimates
- `POST /api/v1/bitcoin/utils/estimate-optimal-fee` - Get optimal fee for transaction

#### Fee Levels
- **Fastest**: ~10 minutes (1 block)
- **Fast**: ~30 minutes (3 blocks)
- **Medium**: ~60 minutes (6 blocks)
- **Slow**: ~120 minutes (12 blocks)
- **Minimum**: ~24 hours (144 blocks)

### 5. RBF Enabled by Default

All transactions now signal RBF by default for maximum flexibility.

#### Implementation
- **File**: `server/src/services/bitcoin/utils.ts`
- Updated `createTransaction()` to use RBF sequence (0xfffffffd) by default
- Can be disabled with `enableRBF: false` option

### 6. Coin Control & UTXO Privacy Analysis

Spend from specific UTXOs and get privacy impact analysis before you sign.

#### Backend Implementation
- **Files**:
  - `server/src/services/bitcoin/utxoSelection.ts`
  - `server/src/services/privacyService.ts`

#### API Endpoints
- `GET /api/v1/wallets/:walletId/privacy` - UTXO privacy scores and summary
- `POST /api/v1/wallets/:walletId/privacy/spend-analysis` - Analyze privacy impact of a UTXO set

#### Frontend Components
- **Files**:
  - `components/send/steps/OutputsStep/CoinControlPanel.tsx`
  - `components/SpendPrivacyCard.tsx`

#### How It Works
1. Users can select specific UTXOs to spend (`selectedUtxoIds`)
2. Wallet privacy scoring highlights linkability and exposure
3. Spend analysis scores the combined privacy impact before signing

### 7. Decoy Change Outputs (Privacy)

Optional change-splitting to reduce address clustering and improve spend privacy.

#### Backend Implementation
- **Files**:
  - `server/src/services/bitcoin/transactionService.ts`
  - `server/src/services/bitcoin/psbtBuilder.ts`

#### Frontend Components
- **Files**:
  - `components/send/AdvancedOptions.tsx`
  - `components/DraftList.tsx`

#### How It Works
1. If enabled, change is split into multiple outputs (decoys)
2. Output count is clamped (2–4) and validated against available change
3. If change is insufficient, falls back to a single change output

### 8. Payjoin (BIP78)

Privacy-preserving send and receive flows using BIP78 Payjoin.

#### Backend Implementation
- **File**: `server/src/services/payjoinService.ts`

#### API Endpoints
- `GET /api/v1/payjoin/eligibility/:walletId` - Check wallet readiness
- `GET /api/v1/payjoin/address/:addressId/uri` - Generate BIP21 with `pj=` param
- `POST /api/v1/payjoin/parse-uri` - Parse BIP21 with Payjoin
- `POST /api/v1/payjoin/attempt` - Attempt Payjoin send (fallback to regular send on failure)
- `POST /api/v1/payjoin/:addressId` - Payjoin receiver endpoint (v1)

#### Frontend Components
- **Files**:
  - `components/PayjoinSection.tsx`
  - `components/WalletDetail.tsx`
  - `components/send/steps/OutputsStep.tsx`

#### How It Works
1. Receiver generates a BIP21 URI with `pj=` param
2. Sender detects Payjoin, attempts collaborative PSBT update
3. If Payjoin fails, send falls back to a normal transaction

## Usage Examples

### Check if Transaction Can Use RBF
```typescript
import * as bitcoinApi from '../src/api/bitcoin';

const result = await bitcoinApi.checkRBF(txid);
if (result.replaceable) {
  console.log(`Current fee: ${result.currentFeeRate} sat/vB`);
  console.log(`Minimum new fee: ${result.minNewFeeRate} sat/vB`);
}
```

### Create RBF Transaction
```typescript
const rbfTx = await bitcoinApi.createRBFTransaction(txid, {
  newFeeRate: 50, // sat/vB
  walletId: 'wallet-id'
});

console.log(`Fee increased by ${rbfTx.feeDelta} sats`);
```

### Create CPFP Transaction
```typescript
const cpfpTx = await bitcoinApi.createCPFPTransaction({
  parentTxid: 'parent-tx-id',
  parentVout: 0,
  targetFeeRate: 50, // sat/vB
  recipientAddress: 'bc1q...',
  walletId: 'wallet-id'
});

console.log(`Effective fee rate: ${cpfpTx.effectiveFeeRate} sat/vB`);
```

### Create Batch Transaction
```typescript
const batchTx = await bitcoinApi.createBatchTransaction({
  recipients: [
    { address: 'bc1q...', amount: 10000 },
    { address: 'bc1q...', amount: 20000 },
    { address: 'bc1q...', amount: 30000 }
  ],
  feeRate: 10,
  walletId: 'wallet-id'
});

console.log(`Saved ${batchTx.savedFees} sats vs individual transactions`);
```

### Get Advanced Fee Estimates
```typescript
const fees = await bitcoinApi.getAdvancedFeeEstimates();

console.log(`Fastest: ${fees.fastest.feeRate} sat/vB (~${fees.fastest.minutes} min)`);
console.log(`Medium: ${fees.medium.feeRate} sat/vB (~${fees.medium.minutes} min)`);
```

## Technical Details

### RBF Sequence Numbers
- **0xfffffffd**: Signals RBF, allows replacement
- **0xfffffffe**: Maximum RBF sequence
- **0xffffffff**: Final, no replacement allowed

### Fee Calculation
- Uses virtual bytes (vBytes) for SegWit transactions
- Accurate size estimation for different script types
- Minimum fee bump of max(1 sat/vB, 10% of current) for RBF

### UTXO Selection
- Largest-first selection for batch transactions
- Automatic change output creation
- Configurable dust threshold (default: 546 sats, see Admin → Variables)
- Optional manual UTXO selection via coin control (`selectedUtxoIds`)

### Safety Features
- Validates all addresses before creating transactions
- Checks sufficient balance including fees
- Prevents creating dust outputs
- Verifies RBF eligibility before replacement
- Calculates accurate fee requirements
- Payjoin attempts validate and sanitize Payjoin URLs before network calls

## Integration Points

### Transaction List
- Add `TransactionActions` component to transaction details
- Shows RBF/CPFP buttons based on transaction status

### Send Flow
- Enhanced fee selection with time estimates
- RBF enabled by default on all transactions
- Link to batch send for multiple recipients
- Coin control, privacy analysis, and decoy outputs integrated in the send flow

### Wallet Routes
- Add `/wallets/:id/batch-send` route for `BatchSend` component

## Future Enhancements

Potential improvements for future versions:

1. **RBF Input Editing**: Allow adding/removing inputs when bumping fees
2. **CPFP Multiple Outputs**: Support spending multiple outputs in one child transaction
3. **Batch Import**: CSV import for batch sending
4. **Fee Bumping Recommendations**: Suggest optimal fee bumps based on mempool
5. **Replace Chain**: Handle replacing already-replaced transactions
6. **Full RBF Support**: Optional full-RBF signaling
7. **Package Relay**: Take advantage of package relay when available

## Security Considerations

1. **RBF Conflicts**: Original transaction may still confirm before replacement
2. **Double Spend Risk**: Merchants should wait for confirmations on RBF transactions
3. **Fee Bumping Limits**: Change output must be large enough to cover fee increases
4. **CPFP Economics**: Child transaction must have sufficient value to pay for both transactions

## Testing Recommendations

1. Test RBF with various fee increases
2. Verify CPFP calculation accuracy
3. Test batch transactions with multiple recipients
4. Confirm fee estimation matches actual network conditions
5. Test edge cases (minimum fees, maximum recipients, etc.)
6. Verify hardware wallet signing for all transaction types
7. Test payjoin eligibility, parsing, and fallback behavior
8. Validate coin control + decoy output combinations
