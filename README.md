<p align="center">
  <img src="assets/logo.svg" alt="Sanctuary Logo" width="80" height="80" />
</p>

<h1 align="center">Sanctuary</h1>

<p align="center">
  <strong>Your keys, your coins, your server.</strong>
</p>

<p align="center">
  A web-based Bitcoin wallet coordinator designed for security-conscious users.<br/>
  Sanctuary never holds private keys—all signing happens on your hardware wallet.<br/>
  Run it locally, on your private server, or in the cloud.
</p>

<p align="center">
  <em>Don't trust. Verify.</em>
</p>

<p align="center">
  <a href="https://nekoguntai.dev/sanctuary/"><strong>Website</strong></a>
  &nbsp;·&nbsp;
  <a href="https://nekoguntai.dev/sanctuary/features.html">Features</a>
  &nbsp;·&nbsp;
  <a href="https://nekoguntai.dev/sanctuary/install.html">Install</a>
  &nbsp;·&nbsp;
  <a href="https://nekoguntai.dev/sanctuary/security.html">Security</a>
  &nbsp;·&nbsp;
  <a href="https://nekoguntai.dev/sanctuary/faq.html">FAQ</a>
</p>

---

> **🚧 EXPERIMENTAL SOFTWARE**
>
> Sanctuary is currently in an **early experimental stage** and under active development. Features may be incomplete, unstable, or change without notice. **Do not use with significant amounts of Bitcoin.** This software has not undergone a formal security audit. Use at your own risk and always verify transactions on your hardware wallet before signing.

---

> ⚠️ **IMPORTANT LEGAL DISCLAIMER**
>
> **NO WARRANTY.** Sanctuary is provided "AS IS" and "AS AVAILABLE" without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, title, and non-infringement.
>
> **LIMITATION OF LIABILITY.** In no event shall the authors, contributors, or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software, including but not limited to any direct, indirect, incidental, special, exemplary, or consequential damages, including loss of Bitcoin, other cryptocurrencies, profits, data, or other intangible losses.
>
> **ASSUMPTION OF RISK.** You acknowledge that:
> - Bitcoin and cryptocurrency involve significant risks including total loss of funds
> - You are solely responsible for securing your private keys, seed phrases, and backups
> - You must verify all transaction details on your hardware wallet before signing
> - Software bugs, security vulnerabilities, or user error may result in permanent loss
> - No software can guarantee protection against all threats
>
> **INDEMNIFICATION.** You agree to indemnify and hold harmless the authors, contributors, and affiliates from any claims, damages, or expenses arising from your use of this software.
>
> **NOT FINANCIAL ADVICE.** This software does not constitute financial, legal, or tax advice. Consult qualified professionals for guidance on your specific situation.
>
> **REGULATORY COMPLIANCE.** You are solely responsible for compliance with all applicable laws and regulations in your jurisdiction regarding cryptocurrency.
>
> **BY USING THIS SOFTWARE, YOU ACCEPT THESE TERMS.**

## Table of Contents

- [Quick Install](#quick-install)
- [First Run](#first-run)
- [Umbrel Installation](#umbrel-installation)
- [Overview](#overview)
- [Screenshots](#screenshots)
- [Features](#features)
- [Architecture](#architecture)
- [Network Ports](#network-ports)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Manual Installation](#manual-installation)
  - [Windows Installation](#windows-installation)
  - [macOS Installation](#macos-installation)
  - [Linux Installation](#linux-installation)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Logging](#logging)
  - [Enabling HTTPS](#enabling-https)
  - [Connecting to Your Own Electrum Server](#connecting-to-your-own-electrum-server)
  - [Hardware Wallet Setup](#hardware-wallet-setup)
- [Usage](#usage)
  - [Importing a Wallet](#importing-a-wallet)
  - [Creating Transactions](#creating-transactions)
  - [Bumping Fees (RBF)](#bumping-fees-rbf)
  - [User Roles & Permissions](#user-roles-permissions)
  - [Admin Settings](#admin-settings)
  - [Two-Factor Authentication](#two-factor-authentication)
  - [Notifications](#notifications)
- [Upgrading](#upgrading)
- [Backup & Restore](#backup-restore)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [AI Assistant (Optional)](#ai-assistant-optional)
- [Support the Project](#support-the-project)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Quick Install

**Prerequisites:** [Docker](https://www.docker.com/products/docker-desktop) and Git

> **New to the command line?** See the [detailed installation guides](#installation) for step-by-step instructions for your operating system.

**Option 1: One-liner** (downloads, clones, and installs automatically)
```bash
curl -fsSL https://raw.githubusercontent.com/nekoguntai-castle/sanctuary/main/install.sh | bash
```
This installs the **latest release** to `~/sanctuary` by default. Set `SANCTUARY_DIR` to customize the location.

**Option 2: Clone first** (if you want to choose the directory)
```bash
git clone https://github.com/nekoguntai-castle/sanctuary.git
cd sanctuary
./install.sh
```

Open **https://localhost:8443** and accept the certificate warning.

> **Time estimate:** First-time installation takes 2-5 minutes (Docker build). Subsequent starts are nearly instant.

<details>
<summary><strong>What the install script does</strong></summary>

1. Checks for Docker and Git
2. Fetches the latest release tag from GitHub
3. Clones the repository and checks out the release
4. Delegates to `scripts/setup.sh` for configuration and startup
5. Generates self-signed SSL certificates (for hardware wallet support)
6. Generates secure random secrets (JWT_SECRET, ENCRYPTION_KEY, ENCRYPTION_SALT, GATEWAY_SECRET, POSTGRES_PASSWORD)
7. Builds and starts the Docker containers
8. Creates a default `admin` user with password `sanctuary` (must be changed on first login)
9. Saves your configuration to `.env` for future restarts

**After installation:**
- **Login credentials:** Username: `admin` / Password: `sanctuary`
- You'll be required to change the password on first login
- Start: `./start.sh`
- Start with AI: `./start.sh --with-ai`
- Start with monitoring: `./start.sh --with-monitoring`
- Start with Tor: `./start.sh --with-tor`
- Stop: `./start.sh --stop`
- View logs: `./start.sh --logs`
- Upgrade: `./install.sh` (fetches and installs the latest release)

</details>

---

## First Run

After installation, follow these steps to set up your Sanctuary:

1. **Open the application**
   - Navigate to **https://localhost:8443** in Chrome, Edge, or Brave
   - Accept the self-signed certificate warning (click "Advanced" then "Proceed")

2. **Log in with default credentials**
   - Username: `admin`
   - Password: `sanctuary`

3. **Set your secure password**
   - You'll be prompted to change the default password immediately
   - Choose a strong password (minimum 8 characters, mix of letters, numbers, symbols)
   - This is a one-time setup step

4. **Add your first wallet**
   - Connect a hardware wallet (Ledger, Trezor) or import via QR code/file
   - Sanctuary will scan for existing transactions

**Troubleshooting first run:**
- **Can't connect?** Wait 30 seconds after install for services to start, then try again
- **Certificate warning?** This is expected for self-signed certificates. Click Advanced and Proceed.
- **API Error?** Run `./start.sh --logs` to check for issues

---

## Umbrel Installation

> **⚠️ Limited Functionality:** Umbrel serves apps over HTTP (not HTTPS), which means:
> - **WebUSB hardware wallets will not work** (Ledger, Trezor USB connections require HTTPS)
> - **QR code camera scanning will not work** (camera access requires HTTPS)
>
> You can still use Sanctuary on Umbrel for:
> - Importing wallets via output descriptors or JSON files
> - Viewing balances and transaction history
> - Creating unsigned PSBTs for air-gapped signing
> - Importing signed PSBTs via file upload (MicroSD workflow)
>
> For full functionality including USB hardware wallets and QR camera scanning, use the [Quick Install](#quick-install) method which enables HTTPS.

If you're running [Umbrel](https://umbrel.com/), you can install Sanctuary as a Community App:

1. Open the **App Store** in your Umbrel
2. Click the **⋯** menu in the upper right corner
3. Select **Community App Stores**
4. Paste: `https://github.com/nekoguntai-castle/sanctuary`
5. Click **Add**
6. Find **Sanctuary** in the App Store and click **Install**

Sanctuary will automatically connect to your Umbrel's Electrum server.

---

## Overview

Sanctuary is a **watch-only wallet coordinator** that helps you manage Bitcoin wallets without exposing private keys to any networked device. It's designed for:

- **Individuals** who want a clean interface for their hardware wallet
- **Families or small teams** who need shared visibility into Bitcoin holdings
- **Security-focused users** who want full control over their wallet infrastructure

### Key Principles

- **No Private Keys** — Sanctuary never sees, stores, or transmits private keys. All transaction signing happens exclusively on your hardware wallet.
- **Self-Hosted** — Run on your own hardware. No third-party servers, no accounts, no tracking.
- **No Installation Required** — Just Docker. No elevated privileges, no system modifications.
- **Portable** — Works on Windows, macOS, and Linux with identical setup.

## Screenshots

<p align="center">
  <img src="assets/screenshots/dashboard.png" alt="Dashboard" width="800" />
  <br/><em>Dashboard - Overview of your wallets and recent activity</em>
</p>

<p align="center">
  <img src="assets/screenshots/wallet.png" alt="Wallet Detail" width="800" />
  <br/><em>Wallet Detail - Addresses, UTXOs, and transaction history</em>
</p>

<p align="center">
  <img src="assets/screenshots/send.png" alt="Send Transaction" width="800" />
  <br/><em>Send Transaction - Build and sign transactions with your hardware wallet</em>
</p>

<p align="center">
  <img src="assets/screenshots/settings.png" alt="Settings" width="800" />
  <br/><em>Settings - Customize themes and preferences</em>
</p>

## Features

- **Multi-wallet support** — Manage multiple wallets (single-sig and multisig)
- **Multi-network support** — Mainnet, testnet, and signet with per-network Electrum connections
- **Network tabs** — Filter wallets by network with visual indicators
- **Hardware wallet integration** — Connect Ledger, Trezor, BitBox02, and Jade devices directly
- **QR code scanning** — Import device xpubs via camera (Keystone, Passport, ColdCard Q)
- **QR code signing** — Sign PSBTs on air-gapped devices and scan back via camera
- **Real-time sync** — Monitor transactions and balances via Electrum or your own Bitcoin node
- **Address management** — Receive/change address tracking with labels
- **UTXO control** — Coin selection for privacy-conscious transactions
- **Transaction building** — Create PSBTs for hardware wallet signing
- **Replace-By-Fee (RBF)** — Bump fees on pending transactions to speed up confirmation
- **Transaction drafts** — Save unsigned transactions, lock selected UTXOs, and coordinate shared signing flows
- **Multi-user access** — Share wallet visibility with family or team members
- **Role-based permissions** — Fine-grained access control (owner, signer, viewer)
- **Group permissions** — Organize users into groups with shared wallet access
- **Admin controls** — Configure public registration and system settings
- **Feature flags** — Toggle optional capabilities like AI, Payjoin, and treasury tooling without a restart
- **Dark mode** — Easy on the eyes, day or night
- **14 color themes** — Sanctuary, Serenity, Forest, Cyber, Sunrise, Ocean, Sakura, Midnight, Bamboo, Copper, Desert, and more
- **Seasonal theme** — Automatically changes colors based on the time of year (spring, summer, autumn, winter)
- **72 backgrounds** — Including 56 animated canvas backgrounds (sakura petals, fireflies, northern lights, paper airplanes, and more) with adjustable opacity
- **Contrast control** — Adjust background contrast for accessibility
- **Two-factor authentication** — Optional TOTP-based 2FA with backup codes
- **Telegram notifications** — Receive transaction alerts via your own Telegram bot
- **Notification sounds** — Configurable audio alerts for transactions and confirmations
- **Update notifications** — Dashboard alerts when new versions are available
- **Audit logging** — Track security-relevant events and user actions (including gateway/mobile API events)
- **Monitoring & diagnostics** — Optional Grafana/Prometheus/Jaeger dashboards plus downloadable anonymized support packages
- **Mobile API gateway** — Secure API for iOS/Android apps with push notifications
- **AI Assistant** — Optional AI-powered transaction labeling and natural language queries (see [AI Assistant](#ai-assistant-optional) below)
- **Treasury Intelligence** — Optional wallet-specific insights and chat when AI feature flags are enabled
- **Treasury Autopilot** — Optional UTXO-health and consolidation controls when treasury features are enabled
- **Backup & restore** — Export/import all data via the web UI

## Architecture

<p align="center">
  <img src="assets/architecture.png" alt="Sanctuary Architecture Diagram" width="900" />
</p>

> The diagram source file is available at [`assets/architecture.drawio`](assets/architecture.drawio) and can be edited with [draw.io](https://app.diagrams.net/).

**Components:**

| Component | Port | Description |
|-----------|------|-------------|
| **Frontend** | :8443 | React-based web interface served via nginx (HTTPS for WebUSB) |
| **Backend** | :3001 | Node.js API server handling wallet logic and user requests |
| **Worker** | :3002 | Background job processor for syncing, notifications, and confirmations |
| **Gateway** | :4000 | HTTPS API gateway for mobile apps with JWT auth and rate limiting |
| **Redis** | :6379 | Job queue (BullMQ) and distributed cache |
| **PostgreSQL** | :5432 | Primary database for wallets, transactions, and user data |

### Worker Process (Background Jobs)

The worker runs as a dedicated container, separate from the API server, handling all background operations:

| Job Type | Description |
|----------|-------------|
| **Electrum Manager** | Maintains persistent connections to Electrum servers with automatic reconnection. Subscribes to new blocks and address activity for real-time transaction detection. |
| **Sync Jobs** | Wallet synchronization with the blockchain. Uses distributed locks to prevent duplicate syncs. Records block height for consistency tracking. |
| **Notification Jobs** | Sends Telegram and push notifications with retry logic (exponential backoff). Handles delivery failures gracefully. |
| **Confirmation Jobs** | Updates transaction confirmations when new blocks are mined. Triggers milestone notifications (1, 3, 6 confirmations). |

**Why a separate worker?**
- Runs 24/7 regardless of user sessions
- Survives API server restarts without losing job state
- Dedicated Electrum connections for real-time updates
- Reliable notification delivery with persistent queue
- Better resource isolation and monitoring

### Mobile API Gateway

The gateway container provides a secure API for iOS and Android mobile apps:

**Features:**
- **Native TLS/HTTPS** — Handles TLS directly for secure mobile connections (enabled by default)
- **JWT Authentication** — Same tokens as web app (shared secret)
- **Route Whitelisting** — Only safe read/write endpoints exposed
- **Rate Limiting** — 60 requests/min default, 5 login attempts/15min
- **Push Notifications** — FCM (Android) and APNs (iOS) support
- **Audit Logging** — Security events logged to database for admin visibility

**How it works:**
1. Mobile apps authenticate via `/api/v1/auth/login`
2. Gateway validates JWT and proxies allowed routes to backend
3. Gateway subscribes to backend WebSocket for transaction events
4. When transactions occur, gateway sends push notifications to registered devices

**Exposed endpoints:**
- Authentication (login, profile)
- Wallets (list, view, sync)
- Transactions (list, view)
- Addresses (list, generate)
- Labels (full CRUD)
- Push device registration

**Blocked by design:**
- Admin routes (`/api/v1/admin/*`)
- User management (create/delete users)
- Node configuration
- Backup/restore operations

The gateway runs on port 4000 by default and starts automatically with Sanctuary (`./start.sh` or `docker compose up`).

## Network Ports

Sanctuary uses HTTPS by default for hardware wallet compatibility:

**Default ports:**
- `HTTPS_PORT=8443` — Main application (https://localhost:8443)
- `HTTP_PORT=8080` — Redirect to HTTPS
- `GATEWAY_PORT=4000` — Mobile API gateway (https://your-server:4000)

**Port requirements:**

| Feature | Required Port | Reason |
|---------|---------------|--------|
| **USB wallets** (Ledger, Trezor, etc.) | HTTPS (8443) | WebUSB requires a secure context |
| **QR Camera** | HTTPS (8443) | Camera access requires a secure context |
| **Mobile API** | HTTPS (4000) | Gateway handles TLS directly for secure mobile connections |
| **File import / SD card** | Any | No special browser API required |

**Note:** Always use HTTPS (port 8443) for full hardware wallet support. HTTP access is limited to file-based workflows only. The setup script writes `GATEWAY_TLS_ENABLED=true`; if you maintain `.env` manually, set it explicitly for HTTPS on the mobile gateway.

## Requirements

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **RAM** | 4 GB | 6 GB (8 GB+ with local AI) |
| **Disk** | 500 MB | 1 GB+ (includes logs and cache) |
| **CPU** | 2 cores | 4 cores |

### Software Requirements

- **Docker** and **Docker Compose** v2.0+
- A modern web browser:
  - Chrome, Edge, or Brave (recommended for hardware wallets)
  - Firefox or Safari (limited hardware wallet support)

### Optional

- **Hardware wallet** — Ledger, Trezor, BitBox02, Jade, Coldcard, Keystone, Passport
- **Electrum server** — For self-sovereign blockchain access (Fulcrum, electrs, ElectrumX)
- **Telegram bot** — For transaction notifications

### Container Overview

Sanctuary runs 6 containers by default:

| Container | Purpose | Always Running |
|-----------|---------|----------------|
| `frontend` | Web UI (nginx) | Yes |
| `backend` | API server | Yes |
| `worker` | Background jobs | Yes |
| `gateway` | Mobile API | Yes |
| `redis` | Job queue & cache | Yes |
| `postgres` | Database | Yes |

Optional containers:
- `ollama` — Local AI for transaction labeling (enabled with `--with-ai`)

## Installation

> **Easiest method:** Use `./install.sh` as shown in [Quick Install](#quick-install) above.
>
> The sections below are for manual installation or platform-specific troubleshooting.

### Manual Installation

If you prefer to run the commands yourself:

```bash
# 1. Clone the repository
git clone https://github.com/nekoguntai-castle/sanctuary.git
cd sanctuary

# 2. Run setup script (generates secrets, SSL certs, builds and starts services)
./scripts/setup.sh

# 3. Open https://localhost:8443
```

The setup script automatically:
- Generates SSL certificates for HTTPS
- Builds and starts all Docker containers
- Creates secure random values for:
- `JWT_SECRET` - Authentication tokens
- `ENCRYPTION_KEY` - Encrypts sensitive data (node passwords, 2FA secrets)
- `ENCRYPTION_SALT` - Salt for key derivation (required in production)
- `GATEWAY_SECRET` - Internal service communication
- `POSTGRES_PASSWORD` - Database password

---

### Windows Installation

#### Option 1: Docker Desktop (Recommended)

1. **Download Docker Desktop**
   - Visit https://www.docker.com/products/docker-desktop
   - Download and run the installer
   - No admin rights needed for installation in user directory

2. **Enable WSL 2 (if prompted)**
   - Docker Desktop will guide you through WSL 2 setup
   - This runs Linux containers natively on Windows

3. **Clone and run**
   ```powershell
   git clone https://github.com/nekoguntai-castle/sanctuary.git
   cd sanctuary
   wsl ./scripts/setup.sh  # Generates secrets, SSL certs, builds and starts
   ```

#### Option 2: WSL 2 + Docker (No Docker Desktop)

For users who prefer not to use Docker Desktop:

1. **Install WSL 2** (run this in PowerShell)
   ```powershell
   wsl --install -d Ubuntu
   ```
   After installation completes, restart your computer. Then open **Ubuntu** from the Start menu to access the Linux terminal.

2. **Inside WSL, install Docker** (run these commands in the Ubuntu/Linux terminal, not PowerShell)
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   # Log out and back in (close and reopen the Ubuntu terminal)
   ```

3. **Clone and run** (still in the Ubuntu/Linux terminal)
   ```bash
   git clone https://github.com/nekoguntai-castle/sanctuary.git
   cd sanctuary
   ./scripts/setup.sh  # Generates secrets, SSL certs, builds and starts
   ```

> **Note:** All commands after step 1 must be run in the Ubuntu/Linux terminal (WSL), not in PowerShell or Command Prompt.

---

### macOS Installation

#### Option 1: Docker Desktop

1. **Download Docker Desktop**
   - Visit https://www.docker.com/products/docker-desktop
   - Download the Mac version (Apple Silicon or Intel)
   - Drag to Applications folder

2. **Clone and run**
   ```bash
   git clone https://github.com/nekoguntai-castle/sanctuary.git
   cd sanctuary
   ./scripts/setup.sh  # Generates secrets, SSL certs, builds and starts
   ```

#### Option 2: Colima (Lightweight Alternative)

For users who prefer a lighter-weight solution:

1. **Install via Homebrew**
   ```bash
   brew install colima docker docker-compose
   ```

2. **Start Colima**
   ```bash
   colima start
   ```

3. **Clone and run**
   ```bash
   git clone https://github.com/nekoguntai-castle/sanctuary.git
   cd sanctuary
   ./scripts/setup.sh  # Generates secrets, SSL certs, builds and starts
   ```

---

### Linux Installation

#### Option 1: Docker Engine (Recommended)

1. **Install Docker**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   # Log out and back in for group changes to take effect
   ```

   ```bash
   # Fedora
   sudo dnf install docker docker-compose-plugin
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER
   ```

   ```bash
   # Arch Linux
   sudo pacman -S docker docker-compose
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER
   ```

2. **Clone and run**
   ```bash
   git clone https://github.com/nekoguntai-castle/sanctuary.git
   cd sanctuary
   ./scripts/setup.sh  # Generates secrets, SSL certs, builds and starts
   ```

#### Option 2: Podman (Rootless Alternative)

For systems where you can't or don't want to run Docker:

1. **Install Podman**
   ```bash
   # Ubuntu/Debian
   sudo apt install podman podman-compose

   # Fedora
   sudo dnf install podman podman-compose
   ```

2. **Clone and run**
   ```bash
   git clone https://github.com/nekoguntai-castle/sanctuary.git
   cd sanctuary
   ./scripts/setup.sh --no-start  # Generates secrets and SSL certs (but don't start with docker)
   podman-compose up -d           # Use podman-compose instead
   ```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root (or run `./scripts/setup.sh` to generate one automatically):

```bash
# HTTPS port (default: 8443) - main application
HTTPS_PORT=8443

# HTTP port for redirect (default: 8080)
HTTP_PORT=8080

# Gateway port for mobile apps (default: 4000)
GATEWAY_PORT=4000

# Gateway TLS - enabled by default for secure mobile connections
GATEWAY_TLS_ENABLED=true

# JWT secret for session tokens (generate a random string, min 32 chars)
JWT_SECRET=your-secret-key-here

# Encryption key for sensitive data like node passwords (generate a random string, min 32 chars)
ENCRYPTION_KEY=your-encryption-key-here

# Encryption salt for key derivation (generate with: openssl rand -base64 16)
# Required in production - used with ENCRYPTION_KEY to derive encryption keys
ENCRYPTION_SALT=your-encryption-salt-here

# Gateway secret for mobile API authentication (generate a random string, min 32 chars)
GATEWAY_SECRET=your-gateway-secret-here

# Database password
POSTGRES_PASSWORD=your-database-password

# Bitcoin network: mainnet, testnet, signet, or regtest
BITCOIN_NETWORK=mainnet

# Electrum server (optional - uses public servers by default)
ELECTRUM_HOST=your-electrum-server.com
ELECTRUM_PORT=50002
ELECTRUM_PROTOCOL=ssl

# Logging level (debug, info, warn, error)
LOG_LEVEL=info
```

### Logging

Sanctuary uses a structured logging system with configurable verbosity levels:

| Level | Description |
|-------|-------------|
| `debug` | Verbose output for development and troubleshooting (WebSocket events, sync details, API calls) |
| `info` | Normal operation messages (startup, sync completion) — **default** |
| `warn` | Warning conditions that don't prevent operation |
| `error` | Error conditions that may affect functionality |

**Setting the log level:**

```bash
# Verbose debugging (see all WebSocket subscriptions, sync operations, etc.)
LOG_LEVEL=debug docker compose up

# Normal operation (default)
LOG_LEVEL=info docker compose up

# Quiet mode (warnings and errors only)
LOG_LEVEL=warn docker compose up

# Minimal output (errors only)
LOG_LEVEL=error docker compose up
```

**Log format:**
```
[2025-12-13T20:57:49.857Z] DEBUG [WS] WebSocket client authenticated: user-id-here
[2025-12-13T20:57:49.921Z] INFO  [SYNC] Background sync service started
[2025-12-13T20:57:50.123Z] WARN  [BLOCKCHAIN] Failed to get tx abc123
[2025-12-13T20:57:50.456Z] ERROR [WALLETS] Database connection failed
```

**Module prefixes:**

*Backend API:*
- `[WS]` — WebSocket server events
- `[BLOCKCHAIN]` — Blockchain/Electrum operations
- `[WALLETS]` — Wallet API operations
- `[ADMIN]` — Admin API operations
- `[BITCOIN]` — Bitcoin RPC/network operations
- `[PRICE]` — Price feed service

*Worker:*
- `[Worker]` — Worker process lifecycle
- `[ElectrumMgr]` — Electrum subscription manager
- `[SyncJobs]` — Wallet sync job handlers
- `[NotifyJobs]` — Notification job handlers
- `[JobQueue]` — BullMQ job queue operations

*Gateway:*
- `[GATEWAY]` — Mobile API gateway operations
- `[REQUEST]` — Gateway request logging
- `[AUTH]` — Gateway authentication
- `[PROXY]` — Gateway backend proxy
- `[FCM]` — Firebase Cloud Messaging (Android push)
- `[APNS]` — Apple Push Notification Service (iOS push)

### Enabling HTTPS

HTTPS is required for WebUSB to work directly in the browser (for hardware wallet access). With HTTPS enabled:
- **All content is served exclusively over HTTPS**
- **HTTP requests are automatically redirected to HTTPS**

The default `docker-compose.yml` stack is already HTTPS-only. The only thing you need is a certificate pair in `docker/nginx/ssl/` (generated automatically by `./scripts/setup.sh` or manually with the steps below).

**Option 1: Self-Signed Certificates (Development)**

```bash
# Generate self-signed certificates
cd docker/nginx/ssl
chmod +x generate-certs.sh
./generate-certs.sh localhost
cd ../../..

# Run with HTTPS (port 8443) + HTTP redirect (port 8080)
HTTPS_PORT=8443 HTTP_PORT=8080 docker compose up -d --build
```

Access at `https://localhost:8443` (or `http://localhost:8080` which redirects to HTTPS). Your browser will warn about the self-signed certificate—click "Advanced" and proceed.

For standard ports (requires root/admin):
```bash
HTTPS_PORT=443 HTTP_PORT=80 docker compose up -d --build
```

**Option 2: mkcert (Locally-Trusted Certificates)**

For a better local development experience without certificate warnings:

```bash
# Install mkcert (https://github.com/FiloSottile/mkcert)
# macOS: brew install mkcert
# Windows: choco install mkcert
# Linux: see mkcert GitHub

# Install local CA (one time)
mkcert -install

# Generate certificates
mkcert -key-file docker/nginx/ssl/privkey.pem -cert-file docker/nginx/ssl/fullchain.pem localhost 127.0.0.1

# Run with HTTPS
HTTPS_PORT=8443 HTTP_PORT=8080 docker compose up -d --build
```

**Option 3: Let's Encrypt (Production)**

For production deployments with a domain name, replace the certificates in `docker/nginx/ssl/` with your Let's Encrypt certificates:
- `fullchain.pem` — Your certificate chain
- `privkey.pem` — Your private key

### Connecting to Your Own Electrum Server

For maximum privacy, connect Sanctuary to your own Electrum server infrastructure.

**Electrum Server (SSL)**
```bash
ELECTRUM_HOST=192.168.1.100
ELECTRUM_PORT=50002
ELECTRUM_PROTOCOL=ssl
```

**Fulcrum/ElectrumX (Local)**
```bash
ELECTRUM_HOST=fulcrum.local
ELECTRUM_PORT=50002
ELECTRUM_PROTOCOL=tcp
```

Supported Electrum server implementations: [Fulcrum](https://github.com/cculianu/Fulcrum), [electrs](https://github.com/romanz/electrs), [ElectrumX](https://github.com/spesmilo/electrumx).

### Hardware Wallet Setup

Sanctuary supports multiple hardware wallet types through different connection methods.

#### Supported Devices

| Device | Connection | Port | Status |
|--------|------------|------|--------|
| **Ledger Nano S/S+/X** | WebUSB | HTTPS (8443) | Supported |
| **Ledger Stax/Flex** | WebUSB | HTTPS (8443) | Supported |
| **Trezor Model One/T** | Trezor Connect | Either | Supported |
| **Trezor Safe 3/5/7** | Trezor Connect | Either | Supported |
| **BitBox02** | WebHID | HTTPS (8443) | Supported |
| **Blockstream Jade** | WebSerial | HTTPS (8443) | Supported |
| **ColdCard** | File (MicroSD) | Any | Supported |
| **ColdCard Q** | QR code or file | HTTPS for QR camera | Supported |
| **Keystone** | QR code or file | HTTPS for QR camera | Supported |
| **Passport** | QR code or file | HTTPS for QR camera | Supported |

#### Connecting a Ledger

1. Open **https://localhost:8443** (HTTPS required for WebUSB)
2. Connect your Ledger via USB
3. Unlock the device with your PIN
4. Open the **Bitcoin app** on your Ledger
5. Click **Connect Device** — your browser will show a USB device picker
6. Select your Ledger to authorize access

#### Connecting a Trezor

1. Open Sanctuary (HTTPS or HTTP)
2. Connect your Trezor via USB
3. Click **Connect Device** and select a Trezor model
4. A popup will open to **connect.trezor.io**
5. Follow the prompts to authorize and export your xpub
6. **Note:** You may need to switch between Trezor Suite and Sanctuary for device operations

#### Connecting a BitBox02

1. Open **https://localhost:8443** (HTTPS required for WebHID)
2. Connect your BitBox02 via USB
3. Click **Connect Device** → **BitBox02**
4. Your browser will show a HID device picker — select your BitBox02
5. Enter the pairing code shown on your BitBox02 screen
6. Unlock with your device password

#### Connecting a Blockstream Jade

1. Open **https://localhost:8443** (HTTPS required for WebSerial)
2. Connect your Jade via USB
3. Click **Connect Device** → **Jade**
4. Your browser will show a serial port picker — select your Jade
5. Unlock your Jade with your PIN
6. The device will initialize and connect

> **Note:** Jade also supports QR code signing for air-gapped operation.

#### Air-Gapped Devices (ColdCard, ColdCard Q, Keystone, Passport)

Air-gapped devices work via PSBT file or QR code — no USB connection needed:

**Option 1: QR Code Scanning** (requires HTTPS for camera access)
1. Open **https://localhost:8443**
2. Click **Connect Device** → **QR Code**
3. Use your camera to scan the device's xpub QR code

**Option 2: File Import**
1. Export the xpub/descriptor as a JSON file from your device
2. Click **Connect Device** → **File Upload**
3. Select the exported file

Once connected, you can:
- Export xpubs for watch-only wallet setup
- Sign transactions (PSBT)
- Verify addresses on the device display

#### Hardware Wallet Troubleshooting

**Ledger: "WebUSB not supported"**
- Ensure you're using Chrome, Edge, or Brave (Firefox/Safari don't support WebUSB)
- Use HTTPS: https://localhost:8443 (check for 🔒 in address bar)
- Don't use HTTP for Ledger devices

**Ledger: "Device not found"**
- Ensure device is plugged in and unlocked
- Open the Bitcoin app on your Ledger
- Close Ledger Live (it locks the USB connection)
- Try a different USB port or cable

**Trezor: Connection fails or popup blocked**
- Allow popups from connect.trezor.io
- Close Trezor Suite if it's open
- If issues persist on HTTPS, try HTTP: http://localhost:8080
- Try a different browser if issues persist

**QR Camera: "Camera access denied"**
- Use HTTPS: https://localhost:8443
- Allow camera permissions when prompted
- Check browser settings if previously denied

**BitBox02: "WebHID not supported"**
- Use Chrome, Edge, or Brave (WebHID required)
- Use HTTPS: https://localhost:8443
- Close BitBoxApp if it's open (it locks the HID connection)

**Jade: "WebSerial not supported"**
- Use Chrome or Edge (WebSerial required)
- Use HTTPS: https://localhost:8443
- Ensure Jade is unlocked before connecting

## Usage

> See [First Run](#first-run) for initial setup steps after installation.

### Importing a Wallet

Sanctuary supports multiple import methods:

- **Output Descriptor** — Paste a descriptor like `wpkh([fingerprint/84'/0'/0']xpub.../0/*)`
- **Hardware Wallet** — Connect Ledger or Trezor to read the xpub directly
- **QR Code Scan** — Scan xpub QR codes from Keystone, Passport, ColdCard Q (HTTPS required for camera)
- **JSON Export** — Import from Sparrow, Specter, or other compatible wallets

### Creating Transactions

1. Go to a wallet and click **Send**
2. Enter recipient address and amount
3. Select fee rate and optionally choose specific UTXOs
   - Click on blocks in the mempool visualizer to populate the fee rate
   - Fee rates support decimals as low as 0.1 sat/vB
4. Review the transaction details
5. Click **Sign with Hardware Wallet**
6. Confirm on your hardware device
7. Broadcast the signed transaction

### Bumping Fees (RBF)

If a transaction is stuck in the mempool, you can bump the fee using Replace-By-Fee:

1. Go to the wallet's **Transactions** tab
2. Click on a pending (unconfirmed) transaction
3. In the transaction details modal, click **Bump Fee (RBF)**
4. Enter a new fee rate (must be higher than the current rate)
5. Click **Bump Fee** to create a replacement transaction
6. Sign with your hardware wallet and broadcast

**Requirements:**
- Transaction must have RBF enabled (sequence number < 0xfffffffe)
- You must be the sender (can't bump received transactions)
- New fee rate must be at least 1 sat/vB higher than the current rate

**Note:** RBF creates a new transaction that replaces the original. Only one will confirm.

### User Roles & Permissions

Sanctuary supports role-based access control for shared wallets:

| Role | View | Edit Labels | Create Transactions | Share/Delete |
|------|------|-------------|---------------------|--------------|
| **Owner** | ✓ | ✓ | ✓ | ✓ |
| **Signer** | ✓ | ✓ | ✓ | ✗ |
| **Viewer** | ✓ | ✗ | ✗ | ✗ |

- **Owner** — Full control. Can share wallets with groups/users and delete the wallet.
- **Signer** — Can view, add/edit labels, and create transactions for signing.
- **Viewer** — Read-only access. Can view transactions and balances but cannot modify anything.

When sharing a wallet with a group, you can set a default role for all group members.

### Admin Settings

Administrators can configure system-wide settings under **Administration → System Settings**:

- **Public Registration** — Enable/disable self-service account creation. When disabled (default), only administrators can create new user accounts.
- **Users & Groups** — Manage shared access for families and teams.
- **Feature Flags** — Enable optional modules like AI Assistant, Treasury Intelligence, Payjoin, and Autopilot.
- **Monitoring** — Open Grafana, Prometheus, and Jaeger when the monitoring stack is enabled.
- **Support Package** — Download an anonymized diagnostic bundle for troubleshooting.

### Two-Factor Authentication

Users can enable TOTP-based two-factor authentication for additional account security:

1. Go to **Account** (click your username in the sidebar)
2. Find the **Two-Factor Authentication** section
3. Click **Enable 2FA**
4. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
5. Enter the 6-digit code to verify
6. **Save your backup codes** — these can be used if you lose access to your authenticator

**Backup codes:**
- 10 single-use codes are generated when 2FA is enabled
- Each code can only be used once
- Store them securely (password manager, printed copy in a safe place)
- You can regenerate codes from the Account page if needed

**Disabling 2FA:**
- Requires your current password and a valid 2FA code
- This is intentionally difficult to prevent unauthorized disabling

### Notifications

Sanctuary supports multiple notification methods to keep you informed about wallet activity.

#### Telegram Notifications

Receive transaction alerts via Telegram using your own bot:

1. **Create a Telegram bot:**
   - Open Telegram and message [@BotFather](https://t.me/BotFather)
   - Send `/newbot` and follow the prompts
   - Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

2. **Get your Chat ID:**
   - Send `/start` to your new bot in Telegram
   - In Sanctuary, go to **Settings → Telegram Notifications**
   - Paste your bot token and click **Fetch** to auto-detect your Chat ID

3. **Configure per-wallet notifications:**
   - Go to any wallet's **Settings** tab
   - Enable Telegram notifications for that wallet
   - Choose which events to receive: received, sent, consolidation

#### Notification Sounds

Configure audio alerts for different transaction events:

1. Go to **Settings → Notification Sounds**
2. Enable sounds globally with the master toggle
3. Configure each event type independently:
   - **Confirmation** — Plays when a transaction gets its first confirmation
   - **Receive** — Plays when Bitcoin is received
   - **Send** — Plays when a transaction is broadcast

Each event can have its own sound from 20 built-in presets (chime, bell, coin, zen, etc.) or be disabled individually.

## Upgrading

The easiest way to upgrade is to re-run the install script, which automatically fetches and installs the latest release:

```bash
cd ~/sanctuary
./install.sh
```

### Manual Upgrade

If you prefer to upgrade manually:

```bash
cd ~/sanctuary

# Fetch all tags and checkout the latest release
git fetch --tags
LATEST=$(git tag --sort=-v:refname | head -1)
git checkout "$LATEST"

# Rebuild and restart
docker compose down
docker compose build
docker compose up -d
```

> **Note:** Both `./install.sh` and the manual upgrade check out a release **tag**, which puts Git in "detached HEAD" state. This is normal — it pins you to a specific release. However, it means `git pull` will not work afterward. Always use `./install.sh` or the manual steps above to upgrade, not `git pull`.

### Checking Your Current Version

```bash
cd ~/sanctuary
git describe --tags --always
```

### Downgrading to a Specific Version

If you need to rollback to a previous release:

```bash
cd ~/sanctuary
git fetch --tags
git tag --sort=-v:refname  # List available versions
git checkout v0.8.7        # Replace with desired version
docker compose down
docker compose build
docker compose up -d
```

## Backup & Restore

Sanctuary provides multiple ways to backup and restore your data.

### Web UI Backup (Recommended)

The easiest way to backup is through the web interface:

1. Go to **Administration → Backup & Restore**
2. Click **Create Backup** to generate a backup JSON file
3. Download the `sanctuary-backup-*.json` file and store it securely
4. If you may restore onto a different instance later, also save your `ENCRYPTION_KEY` and `ENCRYPTION_SALT`

To restore:
1. Go to **Administration → Backup & Restore**
2. Click **Restore from Backup**
3. Upload the backup JSON file and review validation warnings
4. Confirm the destructive restore. Existing data is fully replaced and Sanctuary reloads when the restore finishes.

**What's included in UI backups:**
- All wallets, devices, and their configurations
- User accounts and preferences (including 2FA settings)
- Transaction labels and address labels
- Groups and sharing permissions
- Audit logs

### Cross-Instance Restore Behavior

When restoring a backup to a **different Sanctuary instance** (with different `ENCRYPTION_KEY` or `ENCRYPTION_SALT`), some encrypted data cannot be decrypted. The restore process handles this gracefully:

| Data | Same Instance | Different Instance |
|------|---------------|-------------------|
| Wallets & transactions | ✓ Restored | ✓ Restored |
| User accounts | ✓ Restored | ✓ Restored |
| User passwords | ✓ Restored | ✓ Restored (bcrypt hashed) |
| Transaction labels | ✓ Restored | ✓ Restored |
| Node config passwords | ✓ Restored | ⚠️ Cleared (re-enter in settings) |
| 2FA secrets | ✓ Restored | ⚠️ Cleared (users re-setup 2FA) |

**Warnings are shown** after restore if any encrypted data couldn't be migrated.

**Best practice for server migration:** Copy `ENCRYPTION_KEY` and `ENCRYPTION_SALT` from your old `.env` file to the new instance before restoring the backup. This preserves all encrypted data.

### Command-Line Backup

For scripted or automated backups:

```bash
# Full database backup
docker compose exec postgres pg_dump -U sanctuary sanctuary > backup.sql

# Restore from backup
cat backup.sql | docker compose exec -T postgres psql -U sanctuary sanctuary
```

### What's Stored

Sanctuary stores:
- Wallet metadata (names, descriptors, settings)
- Extended public keys (xpubs) — these are **watch-only**
- Transaction history and labels
- Address derivation state
- User accounts and preferences

Sanctuary **never** stores:
- Private keys
- Seed phrases
- Wallet passwords

## Security Considerations

- **Run locally** when possible for maximum security
- **Use HTTPS** if exposing to a network (see reverse proxy setup)
- **Backup your hardware wallet seed** — Sanctuary cannot recover funds
- **Keep Docker updated** for security patches
- **Use strong passwords** for your Sanctuary account

### First-Login Security

- The default admin password (`sanctuary`) must be changed on first login
- A modal will block access until you set a secure password
- Minimum password length: 8 characters

### TLS Certificate Verification

- Sanctuary verifies TLS certificates when connecting to Electrum servers
- Self-signed certificates are rejected by default for security
- To allow self-signed certificates (e.g., for local servers), enable "Allow Self-Signed Certificates" in Admin → Node Config

### Network Exposure

By default, Sanctuary listens on all network interfaces (`0.0.0.0`). This means it's accessible from other devices on your network.

**To restrict to localhost only:**

```yaml
# docker-compose.override.yml
services:
  frontend:
    ports:
      - "127.0.0.1:${HTTP_PORT:-80}:80"
      - "127.0.0.1:${HTTPS_PORT:-443}:443"
```

**For production deployments:**
- Use a reverse proxy (nginx, Caddy, Traefik) with proper TLS certificates
- Configure firewall rules to restrict access
- Consider VPN access for remote administration

## Troubleshooting

### "You are not currently on a branch" when upgrading

This happens because the installer checks out a release tag, which puts Git in detached HEAD state. **Do not use `git pull` to upgrade.** Instead:

```bash
cd ~/sanctuary
./install.sh
```

If you need to get back on the `main` branch (e.g., for development):
```bash
git checkout main
git pull
```

### Container won't start
```bash
# Check logs
docker compose logs -f

# Rebuild from scratch
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

### Can't connect to hardware wallet
- Ensure HTTPS is enabled (WebUSB requires a secure context)
- Use Chrome, Edge, or Brave (Firefox/Safari don't support WebUSB)
- Try a different USB port
- Check that no other application is using the device (close Ledger Live)
- On Linux, you may need udev rules for your hardware wallet

### Database connection errors
```bash
# Reset the database
docker compose down -v
docker compose up -d
```

### Port already in use
```bash
# Change the port in .env
HTTPS_PORT=9443
HTTP_PORT=9080
docker compose up -d
```

## Development

### Running in Development Mode

```bash
# Start backend dependencies
docker compose up -d postgres redis

# Run backend with hot reload (Node.js 22.x)
cd server
npm install
npm run dev

# Run frontend with hot reload
cd ..
npm install
npm run dev

# Optional: run the mobile gateway locally
cd gateway
npm install
npm run dev
```

### Running Integration Tests

```bash
# From repository root
npm run test:integration
```

This command starts the dedicated test database container, runs Prisma migrations, executes backend integration tests, and then cleans up.

### Project Structure

```
sanctuary/
├── components/        # React components
├── contexts/          # React context providers
├── hooks/             # Custom React hooks
├── shared/            # Shared code across frontend, backend, gateway
│   ├── types/         # Logger, WebSocket, Bitcoin type definitions
│   ├── constants/     # Bitcoin constants (SATS_PER_BTC, address patterns)
│   └── utils/         # Shared utilities (conversions, error handling)
├── server/            # Backend Node.js application
│   ├── src/
│   │   ├── api/       # REST API routes
│   │   ├── services/  # Business logic
│   │   ├── models/    # Prisma database models
│   │   └── worker/    # Background job definitions
│   │       ├── jobs/  # Job handlers (sync, notifications, confirmations)
│   │       ├── electrumManager.ts    # Electrum subscription manager
│   │       └── workerJobQueue.ts     # BullMQ job queue wrapper
│   ├── prisma/        # Database schema and migrations
│   └── worker.ts      # Worker process entry point
├── gateway/           # Mobile API gateway
│   └── src/
│       ├── middleware/ # Auth, rate limiting, logging
│       ├── routes/     # Proxy routes to backend
│       └── services/   # Push notifications (FCM/APNs)
├── src/
│   └── api/           # Frontend API client
├── services/          # Frontend services (hardware wallet, etc.)
├── themes/            # Color theme definitions
├── assets/            # Logo, screenshots, architecture diagram
├── docker/            # Docker configuration files
└── docker-compose.yml
```

## AI Assistant (Optional)

Sanctuary includes an optional AI assistant that can help with:
- **Transaction labeling** — AI suggests labels based on amount, direction, and your existing patterns
- **Natural language queries** — Ask questions like "Show my largest receives this month"

### Setting Up AI

1. **Start or point Sanctuary at an AI runtime**

   **Option A: Bundled Local AI with Ollama (Recommended - Most Private)**
   ```bash
   # Start Sanctuary with bundled Ollama:
   ./start.sh --with-ai
   ```
   - In Sanctuary, click **"Detect"** to auto-configure the endpoint
   - Download a model like `llama3.2:3b` using the **"Pull"** button in settings

   **Option B: Host-installed Ollama (Advanced)**
   ```bash
   # Install Ollama from https://ollama.ai, then:
   ollama serve
   ```
   - Set the endpoint to `http://host.docker.internal:11434`

   **Option C: Cloud AI (Less Private)**
   - Enter an OpenAI-compatible endpoint URL
   - Note: Sanitized transaction metadata will be sent to external servers

2. **Enable the feature flags you want**
   - Go to **Administration → Feature Flags**
   - Enable `aiAssistant` for AI label suggestions and admin AI configuration
   - Enable `treasuryIntelligence` as well if you want the **Intelligence** page with wallet insights and chat

3. **Configure the provider in Sanctuary**
   - Go to **Administration → AI Assistant**
   - Toggle **Enable AI Features**
   - Use **Detect** for bundled Ollama or enter an Ollama/OpenAI-compatible endpoint manually
   - Pick a model and save the settings

### Security

The AI runs in a **security-isolated container**:
- Cannot access private keys or signing operations
- Only receives sanitized metadata (amounts, dates — **no addresses or txids**)
- Runs in a separate network by default (no internet access for local AI)
- All AI suggestions require user confirmation before applying

See [ai-proxy/README.md](ai-proxy/README.md) for technical details.

## Support the Project

If you find Sanctuary useful and want to support its development, consider sending a donation.

### Bitcoin (on-chain)

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=bitcoin%3Abc1qhxsgrh8v3awf3pyc42847z2e7zgygqe05lgekn" alt="Bitcoin QR Code" />
</p>

```
bc1qhxsgrh8v3awf3pyc42847z2e7zgygqe05lgekn
```

### Lightning Address

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=lightning%3Acarpalbutton44%40phoenixwallet.me" alt="Lightning Address QR Code" />
</p>

```
carpalbutton44@phoenixwallet.me
```

### BOLT12 Offer

<p align="center">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0q0k69ewp6vpr8cpc4fd86z8zx6vfsw9mygjvpanytty0rf7dadr2jqsrl3hc5zp5ethevj9fgtw2507ug4qvfaqeejk637u03dmqpy9fyq6sqv6wau6w883t4n4l5yqjfr4ge4ugpttxgeq9cy4gtxhlckats0ce9mph6k4kwrz7dl648999emgcv5p90yl8q25qslw2dfndv3n2gtv20wpkhahexj93dh7w35g832h33e55h3tagqqsu0hv9rtuadpk5rahzc9uj9fdzy" alt="BOLT12 Offer QR Code" />
</p>

<details>
<summary>BOLT12 Offer (click to expand)</summary>

```
lno1zrxq8pjw7qjlm68mtp7e3yvxee4y5xrgjhhyf2fxhlphpckrvevh50u0q0k69ewp6vpr8cpc4fd86z8zx6vfsw9mygjvpanytty0rf7dadr2jqsrl3hc5zp5ethevj9fgtw2507ug4qvfaqeejk637u03dmqpy9fyq6sqv6wau6w883t4n4l5yqjfr4ge4ugpttxgeq9cy4gtxhlckats0ce9mph6k4kwrz7dl648999emgcv5p90yl8q25qslw2dfndv3n2gtv20wpkhahexj93dh7w35g832h33e55h3tagqqsu0hv9rtuadpk5rahzc9uj9fdzy
```

</details>

Your support helps cover development costs and keeps the project independent.

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with React, Node.js, PostgreSQL, and Docker
- Uses bitcoinjs-lib for Bitcoin primitives
- Electrum protocol for blockchain queries
- Inspired by Sparrow, Specter, and the broader Bitcoin ecosystem

---

**Sanctuary** — Your keys, your coins, your server.
