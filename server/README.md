# Sanctuary Wallet - Backend API Server

Node.js/TypeScript backend server for Sanctuary Bitcoin Wallet, providing REST API endpoints for wallet management, Bitcoin integration, and user authentication.

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Bitcoin**: bitcoinjs-lib, Electrum client
- **Authentication**: JWT tokens with bcrypt
- **WebSockets**: ws library for real-time updates

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- (Optional) Bitcoin Core node or Electrum server access

## Quick Start

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Set Up Database

Install and start PostgreSQL, then create a database:

```bash
# Create database
createdb sanctuary

# Or using psql
psql postgres
CREATE DATABASE sanctuary;
\q
```

### 3. Configure Environment

Copy `.env.example` to `.env` and update values:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:
- Update `DATABASE_URL` with your PostgreSQL credentials
- Set a secure `JWT_SECRET` for production
- Configure Bitcoin node or Electrum server settings

### 4. Initialize Database

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations to create tables
npm run prisma:migrate

# (Optional) Seed with test data
npm run prisma:seed
```

### 5. Start Development Server

```bash
npm run dev
```

Server will start on `http://localhost:3001`

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run test:mutation:critical` - Run critical-path mutation testing (address derivation, PSBT, auth/access control)
- `npm run test:mutation:critical:gate` - Run critical mutation tests and enforce baseline gate
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio (database GUI)
- `npm run prisma:seed` - Seed database with test data

## Project Structure

```
server/
├── src/
│   ├── api/              # API route handlers
│   │   ├── auth.ts       # Authentication endpoints
│   │   ├── users.ts      # User management
│   │   ├── wallets.ts    # Wallet endpoints
│   │   ├── transactions.ts
│   │   └── devices.ts
│   ├── services/         # Business logic
│   │   ├── bitcoin/      # Bitcoin integration
│   │   │   ├── electrum.ts
│   │   │   ├── rpc.ts
│   │   │   └── wallet.ts
│   │   ├── auth.ts       # Authentication service
│   │   ├── price.ts      # Price feed service
│   │   └── websocket.ts  # Real-time updates
│   ├── models/           # Data models & Prisma client
│   ├── middleware/       # Express middleware
│   │   ├── auth.ts       # JWT verification
│   │   └── validation.ts # Request validation
│   ├── utils/            # Helper functions
│   ├── config/           # Configuration
│   │   └── index.ts
│   └── index.ts          # Main server file
├── prisma/
│   ├── schema.prisma     # Database schema
│   ├── migrations/       # Database migrations
│   └── seed.ts           # Seed data
├── .env                  # Environment variables
├── .env.example          # Environment template
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies

```

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/refresh` - Refresh JWT token
- `POST /api/v1/auth/logout` - User logout
- `POST /api/v1/auth/logout-all` - Logout all sessions
- `POST /api/v1/auth/2fa/verify` - Verify 2FA token

### Profile
- `GET /api/v1/auth/me` - Get current user
- `PATCH /api/v1/auth/me/preferences` - Update preferences
- `GET /api/v1/auth/me/groups` - Get user's groups
- `GET /api/v1/auth/users/search` - Search users by username

### Wallets
- `GET /api/v1/wallets` - Get user's wallets
- `POST /api/v1/wallets` - Create new wallet
- `GET /api/v1/wallets/:id` - Get wallet details
- `PATCH /api/v1/wallets/:id` - Update wallet
- `DELETE /api/v1/wallets/:id` - Delete wallet
- `POST /api/v1/wallets/:id/sync` - Sync wallet with blockchain

### Transactions
- `GET /api/v1/wallets/:id/transactions` - Get wallet transactions
- `GET /api/v1/transactions/:txid` - Get transaction details
- `GET /api/v1/transactions/:txid/raw` - Get raw tx hex for hardware wallet signing
- `POST /api/v1/wallets/:id/transactions/create` - Create PSBT for signing
- `POST /api/v1/wallets/:id/transactions/batch` - Create batch transaction
- `POST /api/v1/wallets/:id/transactions/estimate` - Estimate fee/size
- `POST /api/v1/wallets/:id/transactions/broadcast` - Broadcast signed tx/PSBT
- `POST /api/v1/wallets/:id/psbt/create` - Create PSBT (hardware wallet flow)
- `POST /api/v1/wallets/:id/psbt/broadcast` - Broadcast signed PSBT

### Devices
- `GET /api/v1/devices` - Get user's devices
- `POST /api/v1/devices` - Register new device
- `PATCH /api/v1/devices/:id` - Update device
- `DELETE /api/v1/devices/:id` - Remove device

### Bitcoin
- `GET /api/v1/bitcoin/status` - Network status
- `GET /api/v1/bitcoin/fees` - Fee estimates
- `GET /api/v1/bitcoin/fees/advanced` - Advanced fee estimates
- `POST /api/v1/bitcoin/address/validate` - Validate Bitcoin address
- `GET /api/v1/bitcoin/transaction/:txid` - Fetch transaction details
- `POST /api/v1/bitcoin/transaction/:txid/rbf-check` - RBF eligibility
- `POST /api/v1/bitcoin/transaction/:txid/rbf` - Create RBF replacement
- `POST /api/v1/bitcoin/transaction/cpfp` - Create CPFP transaction
- `POST /api/v1/bitcoin/transaction/batch` - Create batch transaction
- `POST /api/v1/bitcoin/utils/estimate-optimal-fee` - Optimal fee estimate

### Price
- `GET /api/v1/price` - Get current BTC price
- `GET /api/v1/price/multiple` - Get prices for multiple currencies
- `POST /api/v1/price/convert/to-fiat` - Convert satoshis to fiat

## Database Schema

The database uses PostgreSQL with Prisma ORM. Key tables:

- **users** - User accounts and authentication
- **wallets** - Bitcoin wallets (single-sig and multi-sig)
- **addresses** - Wallet addresses
- **transactions** - Transaction history
- **utxos** - Unspent transaction outputs
- **devices** - Hardware wallet devices
- **groups** - User groups for shared wallets

See `prisma/schema.prisma` for full schema definition.

## Bitcoin Integration

The server supports two modes for Bitcoin connectivity:

### Option 1: Bitcoin Core RPC

Connect to a Bitcoin Core node:

```env
BITCOIN_RPC_HOST=localhost
BITCOIN_RPC_PORT=8332
BITCOIN_RPC_USER=your-rpc-user
BITCOIN_RPC_PASSWORD=your-rpc-password
```

### Option 2: Electrum Server

Connect to an Electrum server (default: Blockstream):

```env
ELECTRUM_HOST=electrum.blockstream.info
ELECTRUM_PORT=50002
ELECTRUM_PROTOCOL=ssl
```

## Background Worker

The worker process is the required owner for recurring maintenance jobs,
Electrum subscriptions, and background processing.

```env
WORKER_HEALTH_URL=http://worker:3002/health
WORKER_HEALTH_TIMEOUT_MS=3000
WORKER_HEALTH_CHECK_INTERVAL_MS=10000
SYNC_ELECTRUM_SUBSCRIPTIONS_ENABLED=true
```

The API server will fail startup/readiness if the worker heartbeat is
unavailable.

Set `SYNC_ELECTRUM_SUBSCRIPTIONS_ENABLED=false` only when subscription
ownership is intentionally handled by another process.

## Security Considerations

1. **JWT Tokens**: Change `JWT_SECRET` in production
2. **Password Hashing**: Uses bcrypt with salt rounds
3. **CORS**: Configure allowed origins in production
4. **Rate Limiting**: Implement rate limiting for production
5. **Input Validation**: All inputs are validated
6. **SQL Injection**: Protected by Prisma ORM

## Development

### Hot Reload

The development server uses `tsx watch` for automatic restart on file changes.

### Database Management

Use Prisma Studio to view and edit database data:

```bash
npm run prisma:studio
```

### Adding Migrations

After modifying `schema.prisma`:

```bash
npm run prisma:migrate
```

## Production Deployment

1. Build the TypeScript code:
   ```bash
   npm run build
   ```

2. Set environment to production:
   ```env
   NODE_ENV=production
   ```

3. Run migrations:
   ```bash
   npx prisma migrate deploy
   ```

4. Start the server:
   ```bash
   npm start
   ```

## Troubleshooting

### Database Connection Issues

- Verify PostgreSQL is running
- Check DATABASE_URL format
- Ensure database exists

### Bitcoin Node Connection

- Verify Bitcoin Core is synced
- Check RPC credentials
- Test Electrum server connectivity

### Port Already in Use

Change the port in `.env`:
```env
PORT=3002
```

## License

MIT
