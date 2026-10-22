# Sanctuary Wallet API Documentation

## Base URL

```
http://localhost:3001/api/v1
```

## Authentication

Most endpoints require authentication via JWT token. Include the token in the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

---

## Authentication Endpoints

### Register User

**POST** `/auth/register`

Create a new user account.

**Request Body:**
```json
{
  "username": "string (required)",
  "password": "string (required)",
  "email": "string (optional)"
}
```

**Response:** `201 Created`
```json
{
  "token": "jwt-token",
  "user": {
    "id": "uuid",
    "username": "string",
    "email": "string",
    "isAdmin": false,
    "preferences": {}
  }
}
```

---

### Login

**POST** `/auth/login`

Authenticate and receive JWT token.

**Request Body:**
```json
{
  "username": "string (required)",
  "password": "string (required)"
}
```

**Response:** `200 OK`
```json
{
  "token": "jwt-token",
  "user": {
    "id": "uuid",
    "username": "string",
    "email": "string",
    "isAdmin": false,
    "preferences": {}
  }
}
```

---

### Get Current User

**GET** `/auth/me`

Get authenticated user's information.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "username": "string",
  "email": "string",
  "isAdmin": false,
  "preferences": {},
  "createdAt": "timestamp"
}
```

---

### Update User Preferences

**PATCH** `/auth/me/preferences`

Update user preferences (theme, currency, etc.).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "darkMode": true,
  "theme": "sanctuary",
  "background": "zen",
  "unit": "sats",
  "fiatCurrency": "USD",
  "showFiat": true
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "username": "string",
  "preferences": {}
}
```

---

## Wallet Endpoints

### Get All Wallets

**GET** `/wallets`

Get all wallets for authenticated user.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "name": "My Wallet",
    "type": "single_sig",
    "scriptType": "native_segwit",
    "network": "mainnet",
    "balance": 1000000,
    "deviceCount": 1,
    "addressCount": 5,
    "createdAt": "timestamp"
  }
]
```

---

### Create Wallet

**POST** `/wallets`

Create a new wallet.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "string (required)",
  "type": "single_sig | multi_sig (required)",
  "scriptType": "native_segwit | nested_segwit | taproot | legacy (required)",
  "network": "mainnet | testnet | regtest (optional)",
  "quorum": "number (required for multi-sig)",
  "totalSigners": "number (required for multi-sig)",
  "descriptor": "string (optional; ignored when signers are given; a descriptor without signers is refused (400). To add a wallet from a descriptor use POST /wallets/import.)",
  "fingerprint": "string (optional)",
  "groupId": "uuid (optional)"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "My Wallet",
  "type": "single_sig",
  "scriptType": "native_segwit",
  "network": "mainnet",
  "balance": 0,
  "deviceCount": 0,
  "addressCount": 0,
  "createdAt": "timestamp"
}
```

---

### Get Wallet

**GET** `/wallets/:id`

Get detailed information about a specific wallet.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "name": "My Wallet",
  "type": "single_sig",
  "scriptType": "native_segwit",
  "network": "mainnet",
  "balance": 1000000,
  "deviceCount": 1,
  "addressCount": 5,
  "createdAt": "timestamp"
}
```

---

### Update Wallet

**PATCH** `/wallets/:id`

Update wallet details (owner only).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "string (optional)",
  "descriptor": "string (optional)"
}
```

**Response:** `200 OK`

---

### Delete Wallet

**DELETE** `/wallets/:id`

Delete a wallet (owner only).

**Headers:** `Authorization: Bearer <token>`

**Response:** `204 No Content`

---

### Get Wallet Statistics

**GET** `/wallets/:id/stats`

Get detailed statistics for a wallet.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "balance": 1000000,
  "received": 2000000,
  "sent": 1000000,
  "transactionCount": 10,
  "utxoCount": 3,
  "addressCount": 5
}
```

---

### Generate Address

**POST** `/wallets/:id/addresses`

Generate a new receiving address for a wallet.

**Headers:** `Authorization: Bearer <token>`

**Response:** `201 Created`
```json
{
  "address": "bc1q..."
}
```

---

### Add Device to Wallet

**POST** `/wallets/:id/devices`

Add a hardware device to a wallet.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "deviceId": "uuid (required)",
  "signerIndex": "number (optional, for multi-sig)"
}
```

**Response:** `201 Created`
```json
{
  "message": "Device added to wallet"
}
```

---

## Device Endpoints

### Get All Devices

**GET** `/devices`

Get all hardware devices for authenticated user.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "type": "ColdCardMk4",
    "label": "My ColdCard",
    "fingerprint": "abcd1234",
    "derivationPath": "m/84'/0'/0'",
    "xpub": "xpub...",
    "createdAt": "timestamp",
    "wallets": []
  }
]
```

---

### Register Device

**POST** `/devices`

Register a new hardware device.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "type": "string (required)",
  "label": "string (required)",
  "fingerprint": "string (required)",
  "derivationPath": "string (optional)",
  "xpub": "string (required)"
}
```

**Response:** `201 Created`

---

### Get Device

**GET** `/devices/:id`

Get detailed information about a device.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`

---

### Update Device

**PATCH** `/devices/:id`

Update device details.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "label": "string (optional)",
  "derivationPath": "string (optional)"
}
```

**Response:** `200 OK`

---

### Delete Device

**DELETE** `/devices/:id`

Remove a device.

**Headers:** `Authorization: Bearer <token>`

**Response:** `204 No Content`

---

## Transaction Endpoints

### Get Wallet Transactions

**GET** `/wallets/:walletId/transactions`

Get all transactions for a wallet.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `limit` (optional, default: 50) - Number of transactions to return
- `offset` (optional, default: 0) - Pagination offset

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "txid": "string",
    "type": "received",
    "amount": "1000000",
    "fee": "500",
    "confirmations": 6,
    "blockHeight": 800000,
    "blockTime": "timestamp",
    "label": "string",
    "memo": "string"
  }
]
```

---

### Get Transaction

**GET** `/transactions/:txid`

Get details of a specific transaction.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`

---

### Get Wallet UTXOs

**GET** `/wallets/:walletId/utxos`

Get all unspent UTXOs for a wallet.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "utxos": [
    {
      "id": "uuid",
      "txid": "string",
      "vout": 0,
      "address": "bc1q...",
      "amount": "1000000",
      "confirmations": 6,
      "blockHeight": 800000
    }
  ],
  "count": 3,
  "totalBalance": 3000000
}
```

---

### Get Wallet Addresses

**GET** `/wallets/:walletId/addresses`

Get all addresses for a wallet.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `used` (optional) - Filter by used status (true/false)
- `limit` (optional) - Max number of addresses to return (pagination)
- `offset` (optional) - Offset for pagination

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "address": "bc1q...",
    "derivationPath": "m/84'/0'/0'/0/0",
    "index": 0,
    "used": false,
    "balance": 0,
    "labels": [
      {
        "id": "uuid",
        "name": "Savings",
        "color": "#00FFAA"
      }
    ],
    "isChange": false,
    "createdAt": "timestamp"
  }
]
```

---

### Get Wallet Address Summary

**GET** `/wallets/:walletId/addresses/summary`

Get summary counts and balances for a wallet's addresses.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "totalAddresses": 120,
  "usedCount": 42,
  "unusedCount": 78,
  "totalBalance": 1500000,
  "usedBalance": 1200000,
  "unusedBalance": 300000
}
```

---

### Create Transaction

**POST** `/wallets/:walletId/transactions`

Create and broadcast a new transaction.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "recipient": "string (required)",
  "amount": "number (required)",
  "feeRate": "number (optional)",
  "label": "string (optional)",
  "memo": "string (optional)"
}
```

**Response:** `501 Not Implemented`
```json
{
  "error": "Not Implemented",
  "message": "Transaction broadcasting not yet implemented. Requires Bitcoin integration."
}
```

---

## Price Endpoints

### Get Current Price

**GET** `/price`

Get current Bitcoin price with aggregation from multiple sources.

**Query Parameters:**
- `currency` (optional, default: USD) - Fiat currency code
- `useCache` (optional, default: true) - Use cached price if available

**Response:** `200 OK`
```json
{
  "price": 45000.50,
  "currency": "USD",
  "sources": [
    {
      "provider": "mempool",
      "price": 45001.20,
      "currency": "USD",
      "timestamp": "2024-01-15T10:30:00.000Z"
    },
    {
      "provider": "coingecko",
      "price": 44999.80,
      "currency": "USD",
      "timestamp": "2024-01-15T10:30:00.000Z"
    }
  ],
  "median": 45000.50,
  "average": 45000.50,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "cached": false
}
```

---

### Get Multiple Prices

**GET** `/price/multiple`

Get prices for multiple currencies at once.

**Query Parameters:**
- `currencies` (required) - Comma-separated list of currency codes (e.g., "USD,EUR,GBP")

**Response:** `200 OK`
```json
{
  "USD": {
    "price": 45000.50,
    "currency": "USD",
    "sources": [...],
    "median": 45000.50,
    "average": 45000.50,
    "timestamp": "2024-01-15T10:30:00.000Z",
    "cached": false
  },
  "EUR": {
    "price": 41500.30,
    "currency": "EUR",
    ...
  }
}
```

---

### Get Price from Specific Provider

**GET** `/price/from/:provider`

Get price from a specific provider (mempool, coingecko, kraken, coinbase, binance).

**Query Parameters:**
- `currency` (optional, default: USD) - Fiat currency code

**Response:** `200 OK`
```json
{
  "provider": "mempool",
  "price": 45001.20,
  "currency": "USD",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### Convert Satoshis to Fiat

**POST** `/price/convert/to-fiat`

Convert satoshis to fiat currency.

**Request Body:**
```json
{
  "sats": 1000000,
  "currency": "USD"
}
```

**Response:** `200 OK`
```json
{
  "sats": 1000000,
  "fiatAmount": 450.50,
  "currency": "USD"
}
```

---

### Convert Fiat to Satoshis

**POST** `/price/convert/to-sats`

Convert fiat currency to satoshis.

**Request Body:**
```json
{
  "amount": 100,
  "currency": "USD"
}
```

**Response:** `200 OK`
```json
{
  "amount": 100,
  "currency": "USD",
  "sats": 222222
}
```

---

### Get Supported Currencies

**GET** `/price/currencies`

Get list of all supported fiat currencies.

**Response:** `200 OK`
```json
{
  "currencies": ["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "JPY", "CNY", "KRW", "INR"],
  "count": 10
}
```

---

### Get Available Providers

**GET** `/price/providers`

Get list of available price providers.

**Response:** `200 OK`
```json
{
  "providers": ["mempool", "coingecko", "kraken", "coinbase", "binance"],
  "count": 5
}
```

---

### Price Provider Health Check

**GET** `/price/health`

Check connectivity to all price providers.

**Response:** `200 OK`
```json
{
  "healthy": true,
  "providers": {
    "mempool": true,
    "coingecko": true,
    "kraken": true,
    "coinbase": false,
    "binance": true
  }
}
```

---

### Get Cache Statistics

**GET** `/price/cache/stats`

Get statistics about the price cache.

**Response:** `200 OK`
```json
{
  "size": 3,
  "entries": ["price:USD", "price:EUR", "price:GBP"]
}
```

---

### Clear Price Cache

**POST** `/price/cache/clear`

Clear all cached price data.

**Response:** `200 OK`
```json
{
  "message": "Cache cleared successfully"
}
```

---

### Set Cache Duration

**POST** `/price/cache/duration`

Set cache duration in milliseconds.

**Request Body:**
```json
{
  "duration": 120000
}
```

**Response:** `200 OK`
```json
{
  "message": "Cache duration updated",
  "duration": 120000
}
```

---

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "error": "Bad Request",
  "message": "Detailed error message"
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "No authentication token provided"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden",
  "message": "Insufficient permissions"
}
```

### 404 Not Found
```json
{
  "error": "Not Found",
  "message": "Resource not found"
}
```

### 409 Conflict
```json
{
  "error": "Conflict",
  "message": "Resource already exists"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal Server Error",
  "message": "Something went wrong"
}
```

### 501 Not Implemented
```json
{
  "error": "Not Implemented",
  "message": "Feature not yet implemented"
}
```

---

## Rate Limiting

Rate limiting is not currently implemented but should be added before production deployment.

## Pagination

Endpoints that return lists support pagination via `limit` and `offset` query parameters:

- `limit`: Number of items to return (default: 50, max: 100)
- `offset`: Number of items to skip (default: 0)

Example:
```
GET /api/v1/wallets/123/transactions?limit=20&offset=40
```

---

## WebSocket

Real-time updates are available via WebSocket at:

```
wss://localhost:8443/ws
```

### Authentication

After connecting, authenticate with your JWT token:

```json
{ "type": "auth", "token": "your-jwt-token" }
```

### Subscriptions

Subscribe to wallet events:

```json
{ "type": "subscribe", "channel": "wallet", "walletId": "uuid" }
```

### Events

The server broadcasts the following events:

| Event | Description |
|-------|-------------|
| `transaction` | New transaction detected |
| `balance` | Wallet balance updated |
| `confirmation` | Transaction confirmation count changed |
| `sync` | Wallet sync status changed |
| `newBlock` | New block detected |
