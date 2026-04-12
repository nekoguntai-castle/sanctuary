# Sanctuary Gateway

The Gateway is a public-facing API proxy for mobile app access to Sanctuary. It handles authentication, rate limiting, and push notifications while keeping the backend server private.

## Architecture Overview

```
                                    ┌─────────────────┐
                                    │   Mobile App    │
                                    │  (iOS/Android)  │
                                    └────────┬────────┘
                                             │
                                   HTTPS/TLS (Direct)
                                      + JWT Auth
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────────────┐
│                           GATEWAY                                   │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐  │
│  │  TLS/HTTPS   │  │ Rate Limiter │  │      JWT Auth           │  │
│  └──────────────┘  └──────────────┘  └─────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  Route Whitelist + HTTP Proxy                 │  │
│  │   Only whitelisted routes are forwarded to backend           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                   Push Notification Services                  │  │
│  │   ┌─────────────┐              ┌─────────────┐               │  │
│  │   │     FCM     │              │    APNs     │               │  │
│  │   │  (Android)  │              │   (iOS)     │               │  │
│  │   └─────────────┘              └─────────────┘               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  Backend Events (WebSocket)                   │  │
│  │   Receives transaction events, triggers push notifications   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                    HTTP (Internal Network)
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                          BACKEND                                    │
│                                                                     │
│   REST API  │  WebSocket Server  │  PostgreSQL  │  Electrum Client │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

## Why a Separate Gateway?

1. **Security Isolation** - Backend stays on private network, only gateway is public
2. **Rate Limiting** - Protect backend from abuse with per-IP limits
3. **Route Whitelisting** - Only safe endpoints exposed to mobile apps
4. **Push Notifications** - Gateway handles FCM/APNs, backend doesn't need credentials
5. **Scalability** - Can run multiple gateway instances, single backend

## Components

### Rate Limiter (`middleware/rateLimit.ts`)

Three rate limiters with different limits:
- **Default** - 60 requests/minute for normal API calls
- **Strict** - 10 requests/hour for sensitive operations
- **Auth** - 5 login attempts/15 minutes to prevent brute force

### JWT Authentication (`middleware/auth.ts`)

Validates JWT tokens from the `Authorization: Bearer <token>` header.
Uses the same JWT_SECRET as the backend for seamless auth.

### Route Whitelist (`routes/proxy.ts`)

Only these routes are proxied to the backend:

| Category | Endpoints |
|----------|-----------|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/2fa/verify`, `GET /auth/me`, `PATCH /auth/me/preferences` |
| Sessions | `GET /auth/sessions`, `DELETE /auth/sessions/:id` |
| Wallets | `GET /wallets`, `GET /wallets/:id`, `POST /wallets/:id/sync` |
| Transactions | `GET /wallets/:id/transactions`, `GET /transactions/:txid`, `GET /transactions/pending`, `POST /wallets/:id/transactions/create`, `POST /wallets/:id/transactions/estimate`, `POST /wallets/:id/transactions/broadcast`, `POST /wallets/:id/psbt/create`, `POST /wallets/:id/psbt/broadcast` |
| Addresses | `GET /wallets/:id/addresses`, `GET /wallets/:id/addresses/summary`, `POST /wallets/:id/addresses/generate` |
| UTXOs | `GET /wallets/:id/utxos` |
| Labels | `GET /wallets/:id/labels`, `POST /wallets/:id/labels`, `PATCH /labels/:id`, `DELETE /labels/:id` |
| Bitcoin | `GET /bitcoin/status`, `GET /bitcoin/fees` |
| Price | `GET /price` |
| Push | `POST /push/register`, `DELETE /push/unregister`, `GET /push/devices`, `DELETE /push/devices/:id` |
| Devices | `GET /devices`, `POST /devices`, `PATCH /devices/:id`, `DELETE /devices/:id` |
| Drafts | `GET /wallets/:id/drafts`, `GET /wallets/:id/drafts/:id`, `POST /wallets/:id/drafts/:id/sign` |
| Mobile Permissions | `GET /mobile-permissions`, `GET /wallets/:id/mobile-permissions`, `PATCH /wallets/:id/mobile-permissions`, `PATCH /wallets/:id/mobile-permissions/:id`, `DELETE /wallets/:id/mobile-permissions/:id/caps`, `DELETE /wallets/:id/mobile-permissions` |

Admin routes, device management, and other sensitive endpoints are NOT exposed.

### Push Notification Services (`services/push/`)

#### FCM (Firebase Cloud Messaging) - Android
- Uses Firebase Admin SDK
- Requires `fcm-service-account.json` from Firebase Console

#### APNs (Apple Push Notification Service) - iOS
- Uses `@parse/node-apn` library
- Requires APNs auth key (`.p8` file) from Apple Developer

### Backend Events (`services/backendEvents.ts`)

WebSocket client that connects to the backend to receive transaction events.

**Event Flow:**
1. Backend detects new transaction via Electrum
2. Backend emits WebSocket event: `{ type: 'transaction', walletId, userId, data }`
3. Gateway receives event
4. Gateway fetches user's push devices from backend
5. Gateway sends push notification via FCM/APNs

## Push Notification Flow

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ Electrum│───▶│ Backend │───▶│ Gateway │───▶│FCM/APNs│───▶│  Mobile │
│ Server  │    │         │    │         │    │        │    │   App   │
└─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘
     │              │              │              │              │
     │   Block/TX   │   WebSocket  │   HTTP       │    Push      │
     │   Updates    │   Event      │   Send       │    Notif     │
     ▼              ▼              ▼              ▼              ▼
 [Bitcoin]      [Detect]      [Receive]      [Deliver]      [Display]
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Environment mode |
| `PORT` | No | `4000` | Gateway port |
| `BACKEND_URL` | Yes | - | Backend HTTP URL (e.g., `http://backend:3001`) |
| `BACKEND_WS_URL` | Yes | - | Backend WebSocket URL (e.g., `ws://backend:3001`) |
| `JWT_SECRET` | Yes | - | Must match backend JWT_SECRET |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `60` | Max requests per window |
| `FCM_ENABLED` | No | `false` | Enable Firebase Cloud Messaging |
| `APNS_ENABLED` | No | `false` | Enable Apple Push Notifications |
| `APNS_KEY_ID` | If APNs | - | APNs key ID |
| `APNS_TEAM_ID` | If APNs | - | Apple Developer Team ID |
| `APNS_BUNDLE_ID` | If APNs | - | iOS app bundle identifier |
| `APNS_PRODUCTION` | No | `false` | Use APNs production server |

### Firebase Setup (Android Push)

1. Go to Firebase Console > Project Settings > Service Accounts
2. Generate new private key (JSON file)
3. Mount at `/app/config/fcm-service-account.json`
4. Set `FCM_ENABLED=true`

### APNs Setup (iOS Push)

1. Go to Apple Developer > Keys > Create Key
2. Enable "Apple Push Notifications service (APNs)"
3. Download the `.p8` key file
4. Note the Key ID and your Team ID
5. Mount key at `/app/config/apns-key.p8`
6. Set env vars: `APNS_ENABLED=true`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`

## Running

### With Docker Compose

The gateway is included in the main `docker-compose.yml` and starts automatically:

```bash
# From project root
docker compose up -d
```

The gateway will be available at `http://localhost:4000` (or your configured `GATEWAY_PORT`).

### For Development

```bash
cd gateway
npm install
npm run dev
```

## API Endpoints

### Health Check
```
GET /health
Response: { "status": "ok", "timestamp": "..." }
```

### Gateway Info
```
GET /info
Response: { "name": "Sanctuary Gateway", "version": "0.1.0", "environment": "..." }
```

### All Other Routes
All other requests are authenticated and proxied to the backend if whitelisted.

## Mobile App Integration

### Registering for Push Notifications

```javascript
// 1. Authenticate
const { token } = await fetch('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username, password }),
}).then(r => r.json());

// 2. Get FCM/APNs token from device
const pushToken = await getDevicePushToken(); // Platform-specific

// 3. Register with backend
await fetch('/api/v1/push/register', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    token: pushToken,
    platform: 'ios', // or 'android'
    deviceName: 'My iPhone',
  }),
});
```

### Handling Push Notifications

Push notifications include a `data` payload:

```json
{
  "type": "transaction",
  "txid": "abc123...",
  "walletName": "My Wallet"
}
```

Use this to navigate to the relevant transaction when tapped.

## Security Considerations

1. **JWT tokens** - Short-lived, must match backend secret
2. **Rate limiting** - Prevents abuse and brute-force attacks
3. **Route whitelist** - Admin and sensitive routes blocked
4. **Internal endpoints** - Some backend endpoints only accessible via X-Gateway-Request header
5. **TLS/HTTPS** - Gateway handles TLS directly for secure mobile connections

## TLS/HTTPS Configuration

The gateway supports HTTPS directly, eliminating the need for a reverse proxy. This is the recommended setup for production.

### Why Direct TLS?

1. **Security boundary alignment** - The gateway handles auth, rate limiting, and validation. It should also handle TLS.
2. **No plaintext internal hops** - Credentials and JWTs are encrypted end-to-end from mobile app to gateway.
3. **Simpler architecture** - No need for nginx/proxy in front of the gateway.
4. **Certificate pinning** - Mobile apps can pin the gateway's certificate directly.

### Enabling TLS

1. **Set environment variables:**
   ```bash
   GATEWAY_TLS_ENABLED=true
   ```

2. **Provide certificates** (uses same location as nginx by default):
   ```
   ./docker/nginx/ssl/fullchain.pem  # Certificate chain
   ./docker/nginx/ssl/privkey.pem    # Private key
   ```

3. **Restart the gateway:**
   ```bash
   ./start.sh --rebuild
   ```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_TLS_ENABLED` | `false` | Enable HTTPS (`true` to enable) |
| `TLS_CERT_PATH` | `/app/config/ssl/fullchain.pem` | Path to certificate file |
| `TLS_KEY_PATH` | `/app/config/ssl/privkey.pem` | Path to private key file |
| `GATEWAY_TLS_MIN_VERSION` | `TLSv1.2` | Minimum TLS version (`TLSv1.2` or `TLSv1.3`) |

### Using Let's Encrypt Certificates

For production, use Let's Encrypt certificates:

```bash
# Install certbot
sudo apt install certbot

# Get certificates (standalone mode)
sudo certbot certonly --standalone -d gateway.yourdomain.com

# Copy to gateway ssl directory
sudo cp /etc/letsencrypt/live/gateway.yourdomain.com/fullchain.pem ./docker/nginx/ssl/
sudo cp /etc/letsencrypt/live/gateway.yourdomain.com/privkey.pem ./docker/nginx/ssl/
sudo chown $USER:$USER ./docker/nginx/ssl/*.pem
```

### TLS Security Settings

The gateway uses modern TLS settings:
- **Minimum version**: TLSv1.2 (configurable to TLSv1.3)
- **Cipher suites**: ECDHE with AES-GCM and ChaCha20-Poly1305
- **No deprecated ciphers**: RC4, 3DES, and export ciphers are disabled

### Mobile App Certificate Pinning

For additional security, mobile apps can pin the gateway's certificate:

```swift
// iOS (Swift)
let pinnedCertificates = [
    SecCertificateCreateWithData(nil, certData as CFData)!
]
```

```kotlin
// Android (Kotlin)
val certificatePinner = CertificatePinner.Builder()
    .add("gateway.yourdomain.com", "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
    .build()
```
