# Hardware Wallet Integration

Technical documentation for Sanctuary's hardware wallet integration architecture.

## Architecture Overview

Sanctuary uses a **registry pattern** with pluggable adapters to support multiple hardware wallet vendors. This design enables adding new device support without modifying the core service.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Browser (React)                                   │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  HardwareWalletService                                                  │  │
│  │  ├── registerAdapter(adapter)                                           │  │
│  │  ├── connect(type) → device                                             │  │
│  │  ├── getXpub(path) → xpub                                               │  │
│  │  └── signPSBT(request) → signed                                         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                     │                                          │
│      ┌──────────────┬───────────────┼───────────────┬──────────────┐         │
│      ▼              ▼               ▼               ▼              ▼         │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ │
│  │  Ledger    │ │  Trezor    │ │  BitBox02  │ │   Jade     │ │  Future    │ │
│  │  (WebUSB)  │ │  (Connect) │ │  (WebHID)  │ │ (WebSerial)│ │  Adapter   │ │
│  └──────┬─────┘ └──────┬─────┘ └──────┬─────┘ └──────┬─────┘ └────────────┘ │
│         │              │              │              │                        │
└─────────┼──────────────┼──────────────┼──────────────┼────────────────────────┘
          │              │              │              │
          ▼              ▼              ▼              ▼
   ┌────────────┐ ┌─────────────┐ ┌────────────┐ ┌────────────┐
   │ Ledger USB │ │ Trezor.io   │ │ BitBox HID │ │ Jade Serial│
   │  (WebUSB)  │ │ (Connect)   │ │  (WebHID)  │ │ (WebSerial)│
   └────────────┘ └─────────────┘ └────────────┘ └────────────┘
```

## Core Components

### File Structure

```
services/hardwareWallet/
├── index.ts              # Exports singleton service, registers adapters
├── service.ts            # HardwareWalletService class
├── types.ts              # TypeScript interfaces
└── adapters/
    ├── index.ts          # Adapter exports
    ├── ledger.ts         # Ledger WebUSB adapter
    ├── trezor.ts         # Trezor Connect adapter
    ├── bitbox.ts         # BitBox02 WebHID adapter
    └── jade.ts           # Blockstream Jade WebSerial adapter
```

### DeviceAdapter Interface

All hardware wallet implementations must implement this interface:

```typescript
interface DeviceAdapter {
  readonly type: DeviceType;
  readonly displayName: string;

  isSupported(): boolean;
  isConnected(): boolean;
  getDevice(): HardwareWalletDevice | null;
  connect(): Promise<HardwareWalletDevice>;
  disconnect(): Promise<void>;
  getXpub(path: string): Promise<XpubResult>;
  signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse>;
  verifyAddress?(path: string, address: string): Promise<boolean>;
}
```

### PSBTSignResponse

Note that the response includes an optional `rawTx` field:

```typescript
interface PSBTSignResponse {
  psbt: string;       // Base64 PSBT (for reference)
  signatures: number; // Number of signatures added
  rawTx?: string;     // Fully signed raw transaction hex
}
```

This is important because **Trezor returns a fully signed raw transaction**, not a signed PSBT. The service layer handles both cases transparently.

---

## Trezor Integration

### Overview

The Trezor adapter uses **Trezor Connect** (`@trezor/connect-web`) to communicate with Trezor devices. Unlike Ledger which uses WebUSB directly, Trezor Connect handles device communication through the Trezor Suite bridge or desktop app.

### Supported Devices

| Device | Internal Model | Detection |
|--------|----------------|-----------|
| Trezor Model One | `1` | `features.model === '1'` |
| Trezor Model T | `T` | `features.model === 'T'` |
| Trezor Safe 3 | `T2B1` | `features.internal_model === 'T2B1'` |
| Trezor Safe 5 | `T3T1` | `features.internal_model === 'T3T1'` |
| Trezor Safe 7 | `T3W1` | `features.internal_model === 'T3W1'` |

### Initialization

```typescript
await TrezorConnect.init({
  manifest: {
    email: 'support@sanctuary.bitcoin',
    appUrl: window.location.origin,
    appName: 'Sanctuary',
  },
  coreMode: 'auto',   // Use bridge or WebUSB as available
  lazyLoad: false,    // Initialize immediately
});
```

### Connection Flow

1. **Initialize** Trezor Connect (once per session)
2. **Get Features** to detect device model and state
3. **Get Public Key** at `m/0'` to obtain master fingerprint
4. Return `HardwareWalletDevice` with device info

### PSBT Signing

Trezor uses its own transaction format, not PSBTs. The adapter:

1. **Parses the PSBT** using bitcoinjs-lib
2. **Fetches reference transactions** from the backend (required for Trezor)
3. **Converts to Trezor format** (inputs, outputs, refTxs)
4. **Calls signTransaction** via Trezor Connect
5. **Returns the signed raw transaction** in `PSBTSignResponse.rawTx`

#### Reference Transactions

Trezor requires the full previous transactions for each input to verify amounts. The adapter fetches these from the backend:

```typescript
const refTxs = await fetchRefTxs(psbt);
// Fetches /api/v1/transactions/{txid}/raw for each input's previous tx
```

#### Script Type Mapping

The adapter maps BIP derivation paths to Trezor script types:

| Path | Trezor Script Type | Bitcoin Address Type |
|------|-------------------|---------------------|
| `m/44'/...` | `SPENDADDRESS` | Legacy (P2PKH) |
| `m/49'/...` | `SPENDP2SHWITNESS` | Nested SegWit (P2SH-P2WPKH) |
| `m/84'/...` | `SPENDWITNESS` | Native SegWit (P2WPKH) |
| `m/86'/...` | `SPENDTAPROOT` | Taproot (P2TR) |

### Important: Raw Transaction Return

Unlike Ledger, **Trezor does not return a signed PSBT**. It returns a fully signed, serialized transaction ready to broadcast:

```typescript
const result = await TrezorConnect.signTransaction({...});
// result.payload.serializedTx is the raw tx hex

return {
  psbt: originalPsbt,  // Original for reference only
  rawTx: result.payload.serializedTx,  // Ready to broadcast
  signatures: inputCount,
};
```

The backend broadcast endpoint accepts both `signedPsbt` and `rawTxHex`, using whichever is provided.

### Error Handling

Common Trezor errors and their user-friendly messages:

| Error Contains | User Message |
|----------------|--------------|
| `Popup closed` | Connection cancelled by user |
| `Device not found` | No Trezor device found. Please connect your device and ensure Trezor Suite is running. |
| `Bridge not running` | Trezor Suite bridge not running. Please open Trezor Suite desktop app. |
| `Cancelled` / `rejected` | Transaction rejected on Trezor. Please approve the transaction on your device. |
| `PIN` | Incorrect PIN. Please try again. |
| `Passphrase` | Passphrase entry cancelled. |
| `Device disconnected` | Trezor disconnected. Please reconnect and try again. |

---

## Ledger Integration

### Overview

The Ledger adapter uses **WebUSB** to communicate directly with Ledger devices in the browser. This requires HTTPS (secure context). The adapter uses two Ledger libraries:

- `@ledgerhq/hw-transport-webusb` - WebUSB transport layer
- `@ledgerhq/hw-app-btc` - Legacy Bitcoin app interface
- `ledger-bitcoin` - Modern Bitcoin app client with wallet policy support

### Supported Devices

| Device | Product ID | Detection |
|--------|-----------|-----------|
| Ledger Nano S | `0x0001` | `productId === 0x0001` |
| Ledger Nano X | `0x0004` | `productId === 0x0004` |
| Ledger Nano S Plus | `0x0005` | `productId === 0x0005` |
| Ledger Stax | `0x0006` | `productId === 0x0006` |
| Ledger Flex | `0x0007` | `productId === 0x0007` |

All Ledger devices share the USB vendor ID: `0x2c97`

### Connection Flow

1. **Check WebUSB support** and secure context (HTTPS)
2. **Request USB permission** via `TransportWebUSB.create()`
3. **Create app instances** - both `AppBtc` and `AppClient`
4. **Get master fingerprint** via `appClient.getMasterFingerprint()`
5. Return `HardwareWalletDevice` with device info

```typescript
const transport = await TransportWebUSB.create();
const app = new AppBtc({ transport });
const appClient = new AppClient(transport);
const fingerprint = await appClient.getMasterFingerprint();
```

### Wallet Policy System

Ledger uses **wallet policies** (BIP-388) for transaction signing. The adapter creates a `DefaultWalletPolicy` with:

1. **Descriptor template** based on script type:
   - `wpkh(@0/**)` - Native SegWit (BIP84)
   - `sh(wpkh(@0/**))` - Nested SegWit (BIP49)
   - `pkh(@0/**)` - Legacy (BIP44)
   - `tr(@0/**)` - Taproot (BIP86)

2. **Key info** in format `[fingerprint/path]xpub`:
   ```
   [73c5da0a/84'/0'/0']xpub6...
   ```

```typescript
const keyInfo = `[${masterFpHex}/${pathWithoutM}]${xpub}`;
const walletPolicy = new DefaultWalletPolicy(descriptorTemplate, keyInfo);
const signatures = await appClient.signPsbt(psbtBase64, walletPolicy, null);
```

### Fingerprint Handling

PSBTs contain fingerprints that must match the connected device. The adapter automatically fixes mismatches:

```typescript
// If PSBT fingerprint doesn't match connected device, update it
if (fpHex.toLowerCase() !== masterFpHex.toLowerCase()) {
  deriv.masterFingerprint = connectedFpBuffer;
}
```

This is important when a PSBT was created with a different fingerprint (e.g., from wallet import).

### BIP32 Derivation Requirement

**Critical:** Ledger requires `bip32Derivation` data in the PSBT for each input. Without this, signing will fail:

```typescript
// Each input must have bip32Derivation
psbt.data.inputs.forEach(input => {
  if (!input.bip32Derivation || input.bip32Derivation.length === 0) {
    // ERROR: Ledger cannot sign this input
  }
});
```

The backend PSBT creation endpoints ensure this data is always present.

### Error Codes

Ledger returns APDU status codes. Common codes and their meanings:

| Status Code | Meaning | User Message |
|-------------|---------|--------------|
| `0x6985` | User rejected | Transaction rejected on device |
| `0x6d00` | INS not supported | Bitcoin app not open on device |
| `0x6e00` | CLA not supported | Bitcoin app not open on device |
| `0x6982` | Security condition not satisfied | Device is locked. Please unlock with PIN. |
| `denied` / `NotAllowed` | USB permission denied | Access denied. Please allow USB access. |

### Address Verification

Ledger supports displaying addresses on device for verification:

```typescript
await app.getWalletPublicKey(path, { verify: true });
// User sees address on device screen and can confirm/reject
```

### Key Differences from Trezor

| Feature | Ledger | Trezor |
|---------|--------|--------|
| Connection | WebUSB (direct) | Trezor Connect (bridge) |
| HTTPS Required | Yes (WebUSB) | No (uses popup) |
| Returns | Signed PSBT | Raw Transaction |
| Desktop App | Close Ledger Live | Open Trezor Suite |
| Bitcoin App | Must be open | Not required |
| Signing Method | Wallet Policy (BIP-388) | Direct transaction signing |
| Reference Txs | Not required | Required for each input |

### Development Journey & Lessons Learned

The Ledger integration went through several iterations. Key learnings from the commit history:

#### 1. DefaultWalletPolicy Discovery (ba8509b)

Initial attempts used the older `@ledgerhq/hw-app-btc` API which required complex wallet registration. The breakthrough was discovering `DefaultWalletPolicy` from `ledger-bitcoin`:

```typescript
// No registration required for standard single-sig wallets!
const walletPolicy = new DefaultWalletPolicy(descriptorTemplate, keyInfo);
```

This works for BIP44/49/84/86 standard derivation paths without pre-registering the wallet on the device.

#### 2. Backend Must Include BIP32 Derivation (d6acefb)

Ledger signing failed silently until we realized PSBTs **must** contain `bip32Derivation` for each input. The backend PSBT creation was modified to:

- Derive public keys from account xpub for each input
- Include master fingerprint in derivation info
- Add full derivation paths (e.g., `m/84'/0'/0'/0/5`)

Without this, Ledger cannot determine which key to use for signing.

#### 3. Account Path Must Match PSBT (a2e0658)

Early versions defaulted to BIP84 (`m/84'/0'/0'`), but this broke signing for BIP44/49 wallets. The fix: detect the account path from the PSBT's `bip32Derivation` data:

```typescript
// Extract account path from first input's derivation
const fullPath = input.bip32Derivation[0].path;  // e.g., "m/44'/0'/0'/0/3"
const accountPath = extractAccountPath(fullPath); // e.g., "m/44'/0'/0'"
```

#### 4. Legacy Addresses Need Full Previous Tx (43876f2)

SegWit inputs use `witnessUtxo` (just the output being spent), but legacy P2PKH inputs require `nonWitnessUtxo` (the entire previous transaction). The backend now:

- Detects legacy wallets by `scriptType === 'p2pkh'`
- Fetches raw transaction hex for each input
- Uses `nonWitnessUtxo` for legacy, `witnessUtxo` for SegWit

#### 5. Fingerprint Mismatch Auto-Fix (89eb491)

Imported wallets often have different fingerprints than the connected device (e.g., wallet was created on a different Ledger, or fingerprint wasn't captured at import). The adapter now auto-corrects:

```typescript
// If PSBT fingerprint doesn't match connected device, update it
if (fpHex !== masterFpHex) {
  deriv.masterFingerprint = connectedFpBuffer;
}
```

This prevents "path mismatch" errors during signing.

#### 6. Already-Finalized PSBT Fix (103470b) - by matt mcp

The final piece of the puzzle! The Ledger adapter finalizes the PSBT after signing (`psbt.finalizeAllInputs()`), but the backend broadcast endpoint was *also* trying to finalize it, causing "Cannot finalize input" errors.

The fix checks if inputs are already finalized before attempting to finalize again:

```typescript
// Check if all inputs are already finalized (e.g., from hardware wallet signing)
const allFinalized = psbt.data.inputs.every(
  (input) => input.finalScriptSig || input.finalScriptWitness
);

// Only finalize if not already finalized
if (!allFinalized) {
  psbt.finalizeAllInputs();
}
```

This was the key fix that made Ledger USB signing work end-to-end.

#### 7. Debugging Was Essential

Multiple commits added extensive logging (`c7cc4a0`, `ab0e69e`) because Ledger errors are often opaque APDU codes. The logging helped identify:
- Which step failed (transport, app client, signing)
- What the PSBT contained vs what Ledger expected
- Fingerprint/path mismatches

---

## BitBox02 Integration

### Overview

The BitBox02 adapter uses **WebHID** to communicate with BitBox02 devices via the `bitbox02-api` npm package. This requires HTTPS (secure context) and Chrome/Edge/Brave.

### Supported Devices

| Device | Edition | Detection |
|--------|---------|-----------|
| BitBox02 Multi | Multi-edition | `edition === 'multi'` |
| BitBox02 BTC-Only | Bitcoin-only | `edition === 'btconly'` |

### Dependencies

- `bitbox02-api` - Official BitBox02 JavaScript API
- `@types/w3c-web-hid` - TypeScript types for WebHID

### Connection Flow

1. **Check WebHID support** and secure context (HTTPS)
2. **Request HID permission** via `navigator.hid.requestDevice()`
3. **Pair with device** - display pairing code, user confirms on device
4. **Unlock device** - user enters password on device
5. Return `HardwareWalletDevice` with device info

### PSBT Signing

BitBox02 uses `btcSignSimple()` which requires converting PSBT to BitBox format:

1. **Parse PSBT** using bitcoinjs-lib
2. **Convert inputs** to BitBox format (prevOutHash, prevOutIndex, prevOutValue, etc.)
3. **Convert outputs** to BitBox format (type, value, scriptConfig)
4. **Call btcSignSimple()** - returns signatures array
5. **Apply signatures** back to PSBT and finalize

### Script Type Mapping

| Derivation Path | BitBox Simple Type | Output Type |
|-----------------|-------------------|-------------|
| `m/44'/...` | `p2pkh` | `P2PKH` |
| `m/49'/...` | `p2wpkh-p2sh` | `P2SH` |
| `m/84'/...` | `p2wpkh` | `P2WPKH` |
| `m/86'/...` | `p2tr` | `P2TR` |

### Key Differences from Other Adapters

| Feature | BitBox02 | Ledger | Trezor |
|---------|----------|--------|--------|
| Connection | WebHID | WebUSB | Connect API |
| HTTPS Required | Yes | Yes | No |
| Pairing | Device-side code | N/A | N/A |
| Returns | Signatures array | Signed PSBT | Raw transaction |
| Desktop App | Close BitBoxApp | Close Ledger Live | Open Trezor Suite |

---

## Jade Integration

### Overview

The Jade adapter uses **WebSerial** to communicate with Blockstream Jade devices. Unlike other devices, Jade has no official JavaScript SDK—the adapter implements the CBOR-RPC protocol directly.

### Dependencies

- `cbor-x` - Fast CBOR encoding/decoding
- `@types/w3c-web-serial` - TypeScript types for WebSerial

### Connection Parameters

```typescript
await port.open({
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
});
```

### CBOR RPC Protocol

All communication uses CBOR-encoded messages:

**Request format:**
```javascript
{ id: "unique-id", method: "get_xpub", params: { path: [84, 0x80000000, 0, 0x80000000, 0, 0x80000000] } }
```

**Response format:**
```javascript
{ id: "unique-id", result: "xpub..." }
// or
{ id: "unique-id", error: { code: -32000, message: "..." } }
```

### Key RPC Methods

| Method | Purpose | Parameters |
|--------|---------|------------|
| `get_version_info` | Get device info | None |
| `auth_user` | Start unlock flow | `network` |
| `get_xpub` | Get extended public key | `path`, `network` |
| `sign_psbt` | Sign PSBT | `psbt` (base64) |
| `get_receive_address` | Display address on device | `path`, `network`, `variant` |

### PSBT Signing

Jade natively supports PSBT signing—no conversion required:

```typescript
const result = await this.sendRpc('sign_psbt', { psbt: base64Psbt });
// result is signed PSBT in base64
```

This is simpler than other devices which require manual PSBT parsing.

### Path Format

Jade requires BIP32 paths as arrays with hardened indices OR'd with 0x80000000:

```typescript
// m/84'/0'/0' becomes:
[84 | 0x80000000, 0 | 0x80000000, 0 | 0x80000000]
```

### Key Differences from Other Adapters

| Feature | Jade | Ledger | Trezor | BitBox02 |
|---------|------|--------|--------|----------|
| Connection | WebSerial | WebUSB | Connect API | WebHID |
| Protocol | CBOR-RPC | APDU | Protobuf | Protobuf |
| HTTPS Required | Yes | Yes | No | Yes |
| Native PSBT | Yes | Yes | No | No |
| Desktop App | N/A | Close Ledger Live | Open Trezor Suite | Close BitBoxApp |
| Air-gap Support | QR codes | N/A | N/A | N/A |

---

## Adding a New Device Adapter

1. Create adapter file in `services/hardwareWallet/adapters/`:

```typescript
// adapters/mydevice.ts
export class MyDeviceAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'mydevice';
  readonly displayName = 'MyDevice';

  isSupported(): boolean {
    // Check browser capabilities
  }

  async connect(): Promise<HardwareWalletDevice> {
    // Connect to device
  }

  async getXpub(path: string): Promise<XpubResult> {
    // Get extended public key
  }

  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    // Sign transaction
  }

  // ... implement other methods
}
```

2. Export from `adapters/index.ts`:

```typescript
export * from './mydevice';
```

3. Register in `index.ts`:

```typescript
import { MyDeviceAdapter } from './adapters/mydevice';
service.registerAdapter(new MyDeviceAdapter());
```

---

## Known Limitations

### Trezor

1. **Requires Trezor Suite** - The Trezor Connect bridge must be running
2. **No signed PSBT** - Returns raw transaction, not PSBT
3. **Reference txs required** - Must fetch previous transactions from backend
4. **Popup-based** - Opens connect.trezor.io popup for operations

### Ledger

1. **HTTPS required** - WebUSB needs secure context
2. **Single connection** - Close Ledger Live before connecting
3. **Bitcoin app required** - Must be open on device

### BitBox02

1. **HTTPS required** - WebHID needs secure context
2. **Single connection** - Close BitBoxApp before connecting
3. **Pairing required** - Must confirm pairing code on device
4. **Chrome/Edge only** - Safari and Firefox don't support WebHID

### Jade

1. **HTTPS required** - WebSerial needs secure context
2. **Chrome/Edge only** - Safari and Firefox don't support WebSerial
3. **No official SDK** - Uses custom CBOR-RPC implementation
4. **Device must be unlocked** - Unlock before connecting

### General

1. **Browser support** - Chrome, Edge, Brave only (WebUSB/WebHID/WebSerial)
2. **No Firefox/Safari** - These browsers don't support WebUSB/WebHID/WebSerial
3. **Camera for QR** - HTTPS required for air-gapped device QR scanning

---

## Testing Considerations

### Testnet Support

Both adapters detect testnet from the derivation path:

```typescript
const isTestnet = path.includes("/1'/");
const coin = isTestnet ? 'Testnet' : 'Bitcoin';
```

### Mocking

For unit tests, mock the adapter interface:

```typescript
const mockAdapter: DeviceAdapter = {
  type: 'trezor',
  displayName: 'Mock Trezor',
  isSupported: () => true,
  connect: async () => mockDevice,
  signPSBT: async () => mockSignedResponse,
  // ...
};
```

---

## Security Notes

1. **Keys never leave device** - All signing happens on hardware
2. **Verify on device** - Users must confirm transactions on device screen
3. **HTTPS enforced** - Ledger requires secure context
4. **No seed phrases** - Sanctuary never has access to recovery phrases
5. **Watch-only** - Sanctuary only stores xpubs, not private keys
