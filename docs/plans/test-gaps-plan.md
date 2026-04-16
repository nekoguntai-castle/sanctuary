# Test Coverage Gaps Plan

> Created: 2026-01-22
> Status: Ready for Implementation

## Summary

After thorough verification of the QA agent's recommendations against actual test files, the codebase has **much better test coverage than initially reported**. Most critical areas (transactions, auth, PSBT validation, device parsers) already have comprehensive tests.

**Actual gaps identified:**
- 5 frontend hooks without tests
- Newly extracted component modules without tests

## Priority 1: Untested Hooks

### 1.1 `useDeviceConnection.ts`
**Purpose:** Manages USB hardware wallet connection lifecycle

**Test file:** `tests/hooks/useDeviceConnection.test.tsx`

**Scenarios to cover:**
```
- Initial state (no device connected)
- Connection initiation
- Successful connection callback
- Connection error handling (NotAllowedError, NotFoundError)
- Device disconnection detection
- Reconnection after disconnect
- Cleanup on unmount
- Concurrent connection attempts
```

**Mocking required:**
- `navigator.usb` / `navigator.hid` APIs
- Hardware wallet service

---

### 1.2 `useDeviceModels.ts`
**Purpose:** Fetches and caches hardware device model information

**Test file:** `tests/hooks/useDeviceModels.test.tsx`

**Scenarios to cover:**
```
- Initial loading state
- Successful fetch of device models
- Error handling on fetch failure
- Caching behavior (no refetch if cached)
- Model lookup by slug
- Model filtering by capability (multisig support, etc.)
```

**Mocking required:**
- `getDeviceModels` API call

---

### 1.3 `useDeviceSave.ts`
**Purpose:** Handles saving device data to backend

**Test file:** `tests/hooks/useDeviceSave.test.tsx`

**Scenarios to cover:**
```
- Save new device
- Update existing device
- Validation errors
- Network error handling
- Optimistic updates
- Rollback on failure
- Loading state during save
```

**Mocking required:**
- Device API calls (`createDevice`, `updateDevice`)

---

### 1.4 `useLoadingState.ts`
**Purpose:** Generic loading state management with timeout handling

**Test file:** `tests/hooks/useLoadingState.test.tsx`

**Scenarios to cover:**
```
- Initial state (not loading)
- Start loading
- Stop loading
- Loading with timeout
- Timeout callback execution
- Multiple concurrent operations
- Reset functionality
- Error state handling
```

**Mocking required:**
- Timer functions (vi.useFakeTimers)

---

### 1.5 `useQrScanner.ts`
**Purpose:** QR code scanning with UR/BBQr animated format support

**Test file:** `tests/hooks/useQrScanner.test.tsx`

**Scenarios to cover:**
```
- Camera permission request
- Permission denied handling
- Single QR code scan
- Animated UR format (multi-part) scanning
- Progress tracking for animated QR
- BBQr format detection and assembly
- Invalid QR data handling
- Camera error recovery
- Cleanup on unmount (stop camera)
```

**Mocking required:**
- Camera/MediaDevices API
- UR decoder libraries
- BBQr decoder

---

## Priority 2: Extracted Component Modules

### 2.1 WalletDetail Modals

**Location:** `components/WalletDetail/modals/`

#### DeleteModal.tsx
**Test file:** `tests/components/WalletDetail/modals/DeleteModal.test.tsx`

**Scenarios:**
```
- Renders with wallet name
- DELETE confirmation required
- Submit button disabled until typed
- Cancel closes modal
- onConfirm called on submit
- Loading state during deletion
- Error handling
```

#### ReceiveModal.tsx
**Test file:** `tests/components/WalletDetail/modals/ReceiveModal.test.tsx`

**Scenarios:**
```
- Displays receive address
- QR code rendered correctly
- Address selector for multiple unused addresses
- Payjoin toggle functionality
- BIP21 URI generation with amount
- Copy to clipboard
- Navigate to settings if no address
```

#### ExportModal.tsx
**Test file:** `tests/components/WalletDetail/modals/ExportModal.test.tsx`

**Scenarios:**
```
- Tab switching (QR, JSON, Descriptor, Labels, Device)
- QR format selector for multisig (Passport vs Raw)
- QR size slider
- JSON download trigger
- Descriptor copy to clipboard
- Labels export (BIP329)
- Device format list loading
- Device format download
```

#### AddressQRModal.tsx
**Test file:** `tests/components/WalletDetail/modals/AddressQRModal.test.tsx`

**Scenarios:**
```
- Displays address in QR code
- Shows full address text
- Copy functionality
- Close on backdrop click
- Close on X button
```

---

### 2.2 DeviceDetail Components

**Location:** `components/DeviceDetail/`

#### ManualAccountForm.tsx
**Test file:** `tests/components/DeviceDetail/ManualAccountForm.test.tsx`

**Scenarios:**
```
- Purpose selection (single_sig/multisig)
- Script type selection
- Derivation path auto-update based on purpose/script
- XPub input validation
- Submit button disabled when invalid
- Loading state during submission
- Form reset
```

#### AccountList.tsx
**Test file:** `tests/components/DeviceDetail/AccountList.test.tsx`

**Scenarios:**
```
- Empty state message
- Renders account list
- Shows account type info correctly
- Recommended badge display
- Derivation path display
- XPub truncation
```

#### accountTypes.ts
**Test file:** `tests/components/DeviceDetail/accountTypes.test.ts`

**Scenarios:**
```
- getAccountTypeInfo returns correct info for each type
- Unknown account type returns fallback
- All ACCOUNT_TYPE_CONFIG entries are valid
```

---

## Implementation Order

### Week 1: Core Hooks
| Day | Task | Estimated Tests |
|-----|------|-----------------|
| 1 | `useLoadingState.test.tsx` | ~10 tests |
| 2 | `useDeviceModels.test.tsx` | ~8 tests |
| 3 | `useDeviceSave.test.tsx` | ~10 tests |
| 4-5 | `useDeviceConnection.test.tsx` | ~15 tests |

### Week 2: QR + Modals
| Day | Task | Estimated Tests |
|-----|------|-----------------|
| 1-2 | `useQrScanner.test.tsx` | ~15 tests |
| 3 | `DeleteModal.test.tsx` + `AddressQRModal.test.tsx` | ~12 tests |
| 4 | `ReceiveModal.test.tsx` | ~10 tests |
| 5 | `ExportModal.test.tsx` | ~15 tests |

### Week 3: DeviceDetail + Polish
| Day | Task | Estimated Tests |
|-----|------|-----------------|
| 1 | `ManualAccountForm.test.tsx` | ~10 tests |
| 2 | `AccountList.test.tsx` + `accountTypes.test.ts` | ~12 tests |
| 3-5 | Edge cases, integration scenarios, coverage gaps | ~20 tests |

---

## Test Infrastructure Notes

### Mocking Patterns

**Hardware APIs:**
```typescript
// Mock USB API
const mockUSB = {
  getDevices: vi.fn(),
  requestDevice: vi.fn(),
};
Object.defineProperty(navigator, 'usb', { value: mockUSB });
```

**Camera/MediaDevices:**
```typescript
const mockMediaDevices = {
  getUserMedia: vi.fn(),
  enumerateDevices: vi.fn(),
};
Object.defineProperty(navigator, 'mediaDevices', { value: mockMediaDevices });
```

### Test Utilities Needed

Consider adding to `tests/mocks/`:
- `hardwareWallet.ts` - Mock hardware wallet service
- `mediaDevices.ts` - Mock camera APIs
- `urDecoder.ts` - Mock UR decoder for QR tests

---

## Success Criteria

- [ ] All 5 hook test files created and passing
- [ ] All 7 component test files created and passing
- [ ] Coverage thresholds maintained (50%+ lines)
- [ ] No regression in existing tests
- [ ] CI pipeline passes

## Estimated Total

- **New test files:** 12
- **New test cases:** ~130
- **Time estimate:** 2-3 weeks
