# Sanctuary - Product Requirements Document

> **Version**: 0.8.7
> **Last Updated**: January 2026
> **Status**: Production

---

## 1. Product Overview

### What is Sanctuary?

Sanctuary is a **watch-only Bitcoin wallet coordinator** designed for security-conscious users who want full control over their Bitcoin wallets without exposing private keys to any networked device.

**Tagline**: *"Your keys, your coins, your server."*

### Problem Statement

Traditional Bitcoin wallet solutions require either:
1. **Hot wallets** - keeping private keys on internet-connected devices (security risk)
2. **Third-party custody** - trusting exchanges/providers with funds
3. **Complex air-gapped workflows** - difficult to use and error-prone

Sanctuary solves this by providing a watch-only interface that:
- Never holds or sees private keys
- Enables secure signing via hardware wallets
- Provides full wallet visibility and control
- Can be self-hosted for maximum privacy
- Supports team/family access with role-based permissions

### Key Principles

| Principle | Description |
|-----------|-------------|
| **No Private Keys** | Signing happens exclusively on hardware wallets |
| **Self-Hosted** | Run on personal hardware, private servers, or cloud |
| **No Installation Required** | Works with Docker on Windows, macOS, Linux |
| **Privacy-First** | No tracking, no accounts, no third-party data collection |
| **Hardware Wallet Native** | Direct integration with industry-standard devices |

---

## 2. User Personas

### 1. Solo Bitcoin Hodler
- **Goal**: Secure personal Bitcoin holdings
- **Usage**: Single wallet, hardware wallet signing
- **Features**: Basic send/receive, transaction history

### 2. Family Office Manager
- **Goal**: Manage family Bitcoin holdings with transparency
- **Usage**: Multiple wallets, shared family access, different roles
- **Features**: Wallet sharing, group management, audit logs

### 3. Exchange Operator / Corporate Treasury
- **Goal**: Multi-user wallet with approval workflows
- **Usage**: Multiple signers, multi-sig wallets, wallet groups
- **Features**: Detailed audit logs, multiple user accounts, group sharing

### 4. Bitcoin Developer
- **Goal**: Test wallet functionality on testnet/signet
- **Usage**: Multiple networks, fee testing, transaction experimentation
- **Features**: Network switching, advanced fee control, PSBT inspection

### 5. Privacy-Conscious Investor
- **Goal**: Self-hosted, no data collection, maximum control
- **Usage**: Self-hosted deployment, custom Electrum servers
- **Features**: Self-hosted setup, HTTPS configuration, air-gapped workflows

---

## 3. Core Features

### A. Multi-Wallet Management

- Create and manage multiple Bitcoin wallets
- Support for **single-signature** and **multi-signature** wallets
- Support for **mainnet, testnet, and signet** networks
- Network tabs to filter wallets by blockchain
- Per-wallet settings and configurations
- Wallet sharing with users and groups

### B. Bitcoin Transaction Features

#### Basic Operations
| Feature | Description |
|---------|-------------|
| Send transactions | Create PSBTs for hardware wallet signing |
| Receive | Display and track receive addresses |
| Transaction history | Full transaction log with details |
| Address management | Track receive and change addresses |
| UTXO control | Coin selection for privacy-conscious transactions |
| Labels | Tag transactions and addresses for organization |

#### Advanced Features
| Feature | Description |
|---------|-------------|
| Replace-By-Fee (RBF) | Bump fees on stuck transactions |
| Child-Pays-For-Parent (CPFP) | Accelerate parent transactions |
| Address derivation | Proper BIP32/44/49/84/86 derivation |
| Multiple outputs | Send to multiple recipients in one tx |
| Mempool visualization | Visual fee rate estimator |

### C. Hardware Wallet Integration

#### Supported Devices

| Device | Connection | Protocol | Status |
|--------|-----------|----------|--------|
| **Ledger** (Nano S/S+/X/Stax/Flex) | WebUSB | Ledger HW API | ✅ Supported |
| **Trezor** (Model One/T/Safe 3/5/7) | Web/USB | Trezor Connect | ✅ Supported |
| **BitBox02** | WebHID | Native WebHID | ✅ Supported |
| **Blockstream Jade** | WebSerial | Native WebSerial | ✅ Supported |
| **ColdCard** | MicroSD / QR | File / QR | ✅ Supported |
| **ColdCard Q** | QR Code | UR2.0 | ✅ Supported |
| **Keystone** | QR Code | UR2.0 | ✅ Supported |
| **Passport** | QR / MicroSD | UR2.0 / File | ✅ Supported |

#### Connection Methods
1. **WebUSB** - Direct browser-to-device (HTTPS required)
2. **Trezor Connect** - Browser popup to Trezor's service
3. **WebHID** - Hardware Interface (HTTPS required)
4. **WebSerial** - Serial port interface (HTTPS required)
5. **QR Code Scanning** - Import via camera (HTTPS required)
6. **File Upload** - Import from JSON/descriptor files (any protocol)

### D. Wallet Collaboration

#### User Roles

| Role | View | Edit Labels | Create Txs | Share/Delete |
|------|:----:|:-----------:|:----------:|:------------:|
| **Owner** | ✓ | ✓ | ✓ | ✓ |
| **Signer** | ✓ | ✓ | ✓ | ✗ |
| **Viewer** | ✓ | ✗ | ✗ | ✗ |

#### Group Management
- Create user groups for shared wallet access
- Assign group members with default roles
- Group-level device sharing
- Device and wallet sharing with individual users

### E. Real-Time Updates

#### WebSocket Features
- Live transaction notifications
- Balance updates
- Confirmation tracking
- Blockchain height updates
- Device connection status
- Wallet sync status

#### Notification Methods
| Method | Description |
|--------|-------------|
| In-App | Real-time toast notifications |
| Telegram | Transaction alerts via Telegram bot |
| Push | Mobile app notifications (FCM/APNs) |
| Sound | Configurable audio alerts |

### F. Customization

#### Themes & Appearance
- **14 color themes**: Sanctuary, Serenity, Forest, Cyber, Sunrise, Ocean, Sakura, Midnight, Bamboo, Copper, Desert, and more
- **Seasonal themes** - Auto-switching based on date
- **Dark mode** with inverted color scales
- **72 backgrounds** including 56 animated canvas patterns
- **Contrast control** - Adjustable background opacity

---

## 4. Key User Flows

### Flow 1: Initial Setup
```
1. Install Sanctuary via Docker
2. Access web interface (https://localhost:8443)
3. Login with default credentials (admin/sanctuary)
4. Change default password (enforced)
5. Accept certificate warning (self-signed HTTPS)
```

### Flow 2: Connect Hardware Wallet
```
1. Click "Connect Device"
2. Select device type (Ledger/Trezor/etc.)
3. Connect device via USB
4. Unlock device with PIN
5. Open Bitcoin app on device
6. Browser requests USB permission
7. Device xpub is imported
8. Device saved with label and fingerprint
```

### Flow 3: Import Wallet
```
1. Click "Import Wallet"
2. Choose import method (descriptor/xpub/QR/file)
3. Validate descriptor/xpub
4. Set wallet name, network, script type
5. Create wallet
6. System generates receive addresses
7. Begin blockchain sync
```

### Flow 4: Send Transaction
```
1. Navigate to wallet → Send
2. Enter recipient address and amount
3. Adjust fee rate (or use visualizer)
4. Optional: Select specific UTXOs
5. Review transaction details
6. Sign with hardware wallet
7. Confirm on device
8. Broadcast to network
```

### Flow 5: Bump Fee (RBF)
```
1. Navigate to pending transaction
2. Click "Bump Fee (RBF)"
3. Enter new fee rate
4. Sign with hardware wallet
5. Broadcast replacement
```

---

## 5. Technical Architecture

### Technology Stack

#### Frontend
| Technology | Purpose |
|------------|---------|
| React 19 | UI Framework |
| Tailwind CSS | Styling |
| TanStack Query | State Management |
| React Router 7 | Routing |
| Vite | Build Tool |
| Vitest | Testing |

#### Backend
| Technology | Purpose |
|------------|---------|
| Node.js 18+ | Runtime |
| TypeScript | Language |
| Express.js | HTTP Framework |
| PostgreSQL 14+ | Database |
| Prisma | ORM |
| JWT + bcrypt | Authentication |
| ws | WebSocket |
| bitcoinjs-lib | Bitcoin operations |

### Architecture Diagram

```
┌─────────────────────────────────────┐
│      Frontend (nginx HTTPS)         │
│         :8443 / :8080               │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────┐
│      Backend (Node.js)              │
│         :3001 (internal)            │
└────────────┬────────────────────────┘
             │
     ┌───────┴────────┐
     │                │
┌────▼──────┐  ┌─────▼──────┐
│ PostgreSQL│  │   Redis    │
│   :5432   │  │   :6379    │
└───────────┘  └────────────┘

┌─────────────────────────────────────┐
│   Gateway (Mobile API)              │
│         :4000 (internal)            │
└─────────────────────────────────────┘

External Dependencies:
- Electrum Servers (blockchain data)
- FCM / APNs (push notifications)
```

### API Layer Architecture

```
Routes (HTTP Handling)
        ↓
Services (Business Logic)
        ↓
Repositories (Data Access)
        ↓
Prisma (ORM / Database)
```

### Database Schema Overview

| Category | Tables |
|----------|--------|
| **User Management** | users, groups, group_members, user_preferences, refresh_tokens |
| **Wallet Management** | wallets, wallet_users, addresses, utxos, draft_transactions |
| **Bitcoin Data** | transactions, transaction_inputs, transaction_outputs, labels |
| **Hardware Devices** | devices, device_accounts, device_users, wallet_devices |
| **System** | node_configs, electrum_servers, fee_estimates, audit_logs |

---

## 6. Security

### Authentication & Authorization

| Feature | Implementation |
|---------|----------------|
| Password hashing | bcrypt with salt |
| Session management | JWT access + refresh tokens |
| Token rotation | On every refresh |
| 2FA | TOTP with backup codes |
| Default password | Enforced change on first login |

### Zero-Knowledge Architecture

```
Private Key Flow:
┌──────────────┐     PSBT      ┌──────────────┐
│   Server     │ ────────────► │   Browser    │
│ (no keys)    │               │              │
└──────────────┘               └──────┬───────┘
                                      │
                                      ▼
                               ┌──────────────┐
                               │   Hardware   │
                               │   Wallet     │
                               │ (has keys)   │
                               └──────┬───────┘
                                      │
                                      ▼ Signed PSBT
                               ┌──────────────┐
                               │   Broadcast  │
                               └──────────────┘
```

### Access Control

| Level | Description |
|-------|-------------|
| Admin | Full system access |
| User | Own wallets/devices |
| Group Member | Shared wallet access |
| Wallet Role | Owner/Signer/Viewer permissions |

### Audit Logging

Logged events:
- User login/logout
- Password and 2FA changes
- Wallet creation/deletion
- Wallet sharing changes
- Device registration/removal
- Admin actions
- Failed authentication attempts

---

## 7. Bitcoin Features

### Wallet Types

| Type | Description | Use Case |
|------|-------------|----------|
| Single-sig | One key required | Personal use |
| Multi-sig | M-of-N keys required | Enhanced security |

### Script Types

| Type | Address Format | Path | xpub Prefix |
|------|---------------|------|-------------|
| Legacy (P2PKH) | 1... | m/44'/0'/... | xpub |
| Nested SegWit | 3... | m/49'/0'/... | ypub |
| Native SegWit | bc1q... | m/84'/0'/... | zpub |
| Taproot | bc1p... | m/86'/0'/... | xpub |

### Networks

| Network | Description |
|---------|-------------|
| Mainnet | Real BTC, production |
| Testnet | Test BTC, development |
| Signet | Controlled test network |

### Fee Estimation

| Level | Target | Description |
|-------|--------|-------------|
| Fastest | ~1 block | ~10 minutes |
| Fast | ~3 blocks | ~30 minutes |
| Medium | ~6 blocks | ~60 minutes |
| Slow | ~12 blocks | ~120 minutes |

---

## 8. Deployment

### Docker Compose

```bash
# Quick start
./start.sh

# Rebuild after changes
./start.sh --rebuild

# Stop services
./start.sh --stop
```

### System Requirements

| Tier | CPU | RAM | Storage |
|------|-----|-----|---------|
| Minimum | 2 cores | 4GB | 500MB |
| Recommended | 4 cores | 8GB | 2GB |
| With AI | 4+ cores | 12GB+ | 20GB+ |

### Environment Configuration

```env
# Security
JWT_SECRET=<random-string>
ENCRYPTION_KEY=<random-string>
POSTGRES_PASSWORD=<strong-password>

# Bitcoin
BITCOIN_NETWORK=mainnet
ELECTRUM_HOST=electrum.blockstream.info
ELECTRUM_PORT=50002

# Ports
HTTPS_PORT=8443
HTTP_PORT=8080
```

---

## 9. Codebase Statistics

| Category | Lines of Code | Files |
|----------|-------------:|------:|
| TypeScript (.ts) | 197,715 | 573 |
| React (.tsx) | 48,248 | 105 |
| Test code | 80,599 | - |
| **Total** | **~270,000** | **770** |

### By Component

| Component | Lines |
|-----------|------:|
| Backend (server/) | 146,834 |
| Frontend (src/components/) | 55,729 |
| Mobile Gateway | 2,183 |
| Shared utilities | 1,106 |

---

## 10. Competitive Advantages

1. **Fully Self-Hosted** - No third-party dependency
2. **No Private Keys Server-Side** - Maximum security
3. **Open Source** - Transparent, auditable code
4. **Multi-Wallet Support** - Manage all holdings in one place
5. **Hardware Wallet Native** - All major devices supported
6. **Collaboration Built-In** - Team/family access
7. **Advanced Bitcoin Features** - RBF, CPFP, UTXO control
8. **Beautiful UI** - 14 themes, 72 backgrounds
9. **Docker Container** - One-click deployment
10. **Real-Time Updates** - WebSocket live sync

---

## 11. Success Metrics

### User Engagement
- Daily/monthly active users
- Feature adoption rates
- Average session duration

### Security
- Zero security incidents
- Zero lost funds incidents

### Performance
- Sync completion time < 30s
- API response time < 200ms
- WebSocket reconnection < 5s

---

## 12. Legal & Compliance

### Disclaimers
- Experimental software - use at own risk
- No warranty provided
- Not financial advice
- User responsible for regulatory compliance

---

## Appendix: API Reference

### Authentication
```
POST /api/v1/auth/login
POST /api/v1/auth/register
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
```

### Wallets
```
GET    /api/v1/wallets
POST   /api/v1/wallets
GET    /api/v1/wallets/:id
PATCH  /api/v1/wallets/:id
DELETE /api/v1/wallets/:id
POST   /api/v1/wallets/:id/sync
```

### Transactions
```
GET  /api/v1/wallets/:id/transactions
GET  /api/v1/transactions/:txid
GET  /api/v1/transactions/:txid/raw
POST /api/v1/wallets/:id/transactions/create
POST /api/v1/wallets/:id/transactions/batch
POST /api/v1/wallets/:id/transactions/broadcast
POST /api/v1/wallets/:id/transactions/estimate
POST /api/v1/wallets/:id/psbt/create
POST /api/v1/wallets/:id/psbt/broadcast
```

### Devices
```
GET    /api/v1/devices
POST   /api/v1/devices
PATCH  /api/v1/devices/:id
DELETE /api/v1/devices/:id
```

### Bitcoin
```
GET  /api/v1/bitcoin/fees
GET  /api/v1/bitcoin/fees/advanced
POST /api/v1/bitcoin/broadcast
POST /api/v1/bitcoin/transaction/:txid/rbf-check
POST /api/v1/bitcoin/transaction/:txid/rbf
POST /api/v1/bitcoin/transaction/cpfp
POST /api/v1/bitcoin/transaction/batch
POST /api/v1/bitcoin/utils/estimate-optimal-fee
```

### Price
```
GET  /api/v1/price
GET  /api/v1/price/multiple
POST /api/v1/price/convert/to-fiat
```
