# Historical Price Data Implementation

Complete implementation of Bitcoin historical price fetching using CoinGecko API.

## Overview

The system now supports fetching historical Bitcoin prices for specific dates and date ranges, enabling features like portfolio performance tracking, historical transaction values, and price charts.

## Features Implemented

### 1. Historical Price for Specific Date
Get Bitcoin price on any date since 2013.

### 2. Price History for Date Range
Get price history over periods from 1 day to 1 year.

### 3. Intelligent Caching
Historical prices are cached as they don't change, improving performance.

## API Endpoints

### Get Historical Price

**GET** `/api/v1/price/historical`

Get Bitcoin price for a specific date.

**Query Parameters:**
- `date` (required) - Date in YYYY-MM-DD or ISO format
- `currency` (optional) - Currency code (default: USD)

**Example Request:**
```bash
GET /api/v1/price/historical?date=2024-01-01&currency=USD
```

**Example Response:**
```json
{
  "date": "2024-01-01T00:00:00.000Z",
  "currency": "USD",
  "price": 42258.50,
  "provider": "coingecko"
}
```

### Get Price History

**GET** `/api/v1/price/history`

Get price history over a date range.

**Query Parameters:**
- `days` (optional) - Number of days (1-365, default: 30)
- `currency` (optional) - Currency code (default: USD)

**Example Request:**
```bash
GET /api/v1/price/history?days=7&currency=USD
```

**Example Response:**
```json
{
  "currency": "USD",
  "days": 7,
  "dataPoints": 168,
  "history": [
    {
      "timestamp": "2024-12-03T00:00:00.000Z",
      "price": 96500.25
    },
    {
      "timestamp": "2024-12-04T00:00:00.000Z",
      "price": 97200.50
    }
  ],
  "provider": "coingecko"
}
```

## Backend Implementation

### 1. Provider Functions (`server/src/services/price/providers.ts`)

**fetchCoinGeckoHistoricalPrice()**
```typescript
export async function fetchCoinGeckoHistoricalPrice(
  date: Date,
  currency: string = 'USD'
): Promise<PriceData>
```

Fetches Bitcoin price for a specific date using CoinGecko's `/coins/bitcoin/history` endpoint.

- Formats date as DD-MM-YYYY (CoinGecko requirement)
- Returns price at 00:00 UTC on that date
- Supports 10+ fiat currencies
- 10 second timeout for historical queries

**fetchCoinGeckoMarketChart()**
```typescript
export async function fetchCoinGeckoMarketChart(
  days: number,
  currency: string = 'USD'
): Promise<Array<{ timestamp: Date; price: number }>>
```

Fetches price history over a range using CoinGecko's `/coins/bitcoin/market_chart` endpoint.

- Supports 1-365 days
- Hourly data for ≤1 day
- Daily data for >1 day
- Returns array of timestamp/price pairs

### 2. Price Service (`server/src/services/price/index.ts`)

**getHistoricalPrice()**
```typescript
async getHistoricalPrice(
  currency: string = 'USD',
  date: Date
): Promise<number>
```

Features:
- Normalizes date to start of day
- Checks cache first
- Long cache timeout (historical prices don't change)
- Error handling with meaningful messages

**getPriceHistory()**
```typescript
async getPriceHistory(
  currency: string = 'USD',
  days: number = 30
): Promise<Array<{ timestamp: Date; price: number }>>
```

Features:
- Validates day range (1-365)
- Caches results with reasonable timeout
- Returns full time series data
- Optimized for chart rendering

### 3. API Routes (`server/src/api/price.ts`)

Two new endpoints added:
- `/api/v1/price/historical` - Single date lookup
- `/api/v1/price/history` - Date range query

Both include:
- Input validation
- Date parsing and validation
- Error handling
- Standard response format

## Data Format

### CoinGecko Date Format
CoinGecko requires dates in DD-MM-YYYY format:

```typescript
const day = String(date.getDate()).padStart(2, '0');
const month = String(date.getMonth() + 1).padStart(2, '0');
const year = date.getFullYear();
const dateStr = `${day}-${month}-${year}`; // e.g., "01-01-2024"
```

### Response Format
ISO 8601 timestamps in responses:

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "price": 42258.50
}
```

## Caching Strategy

### Cache Keys
- Historical: `historical_USD_2024-01-01T00:00:00.000Z`
- History: `history_USD_30d`

### Cache Duration
- Historical prices: Longer cache (prices don't change)
- Price history: Standard cache timeout
- Current prices: Short cache (1 minute default)

### Cache Benefits
- Reduces API calls to CoinGecko
- Faster response times
- Respects rate limits
- Saves bandwidth

## Use Cases

### 1. Portfolio Performance
Track wallet value over time:

```typescript
// Get wallet transactions
const transactions = await getTransactions(walletId);

// Get historical price for each transaction
const valueHistory = await Promise.all(
  transactions.map(async (tx) => {
    const price = await getHistoricalPrice('USD', tx.blockTime);
    const value = (tx.amount / 100000000) * price;
    return { date: tx.blockTime, value };
  })
);
```

### 2. Transaction Value at Time
Show fiat value when transaction occurred:

```typescript
const tx = await getTransaction(txid);
const historicalPrice = await getHistoricalPrice('USD', tx.blockTime);
const valueAtTime = (tx.amount / 100000000) * historicalPrice;

console.log(`Value when received: $${valueAtTime.toFixed(2)}`);
```

### 3. Price Charts
Display price history chart:

```typescript
const history = await getPriceHistory('USD', 30);

// Format for chart library
const chartData = history.map(({ timestamp, price }) => ({
  x: timestamp,
  y: price
}));
```

### 4. Profit/Loss Calculation
Calculate gains/losses:

```typescript
const purchaseDate = new Date('2023-01-01');
const purchasePrice = await getHistoricalPrice('USD', purchaseDate);
const currentPrice = await getPrice('USD');

const btcAmount = 0.5;
const costBasis = btcAmount * purchasePrice;
const currentValue = btcAmount * currentPrice;
const profitLoss = currentValue - costBasis;
const percentage = ((currentValue - costBasis) / costBasis) * 100;

console.log(`Profit/Loss: $${profitLoss.toFixed(2)} (${percentage.toFixed(2)}%)`);
```

## Rate Limits

### CoinGecko Free API
- 10-30 calls/minute (varies)
- No API key required
- Rate limiting handled by service

### Best Practices
1. Use caching aggressively
2. Batch historical lookups when possible
3. Don't query same date repeatedly
4. Consider upgrading to CoinGecko Pro for higher limits

## Error Handling

### Common Errors

**Date in Future**
```json
{
  "error": "Bad Request",
  "message": "Date cannot be in the future"
}
```

**Invalid Date Format**
```json
{
  "error": "Bad Request",
  "message": "Invalid date format. Use YYYY-MM-DD or ISO format"
}
```

**Historical Data Not Available**
```json
{
  "error": "Bad Request",
  "message": "Historical price not available for EUR on 01-01-2010"
}
```

**Rate Limit Exceeded**
```json
{
  "error": "Bad Request",
  "message": "CoinGecko historical API error: Rate limit exceeded"
}
```

## Supported Currencies

Historical prices available for:
- **USD** - US Dollar
- **EUR** - Euro
- **GBP** - British Pound
- **CAD** - Canadian Dollar
- **CHF** - Swiss Franc
- **AUD** - Australian Dollar
- **JPY** - Japanese Yen
- **CNY** - Chinese Yuan
- **KRW** - Korean Won
- **INR** - Indian Rupee

## Testing

### Test Historical Price

```bash
# Get price on specific date
curl "http://localhost:3000/api/v1/price/historical?date=2024-01-01&currency=USD"

# Expected: Price around $42,000 on Jan 1, 2024
```

### Test Price History

```bash
# Get 7-day history
curl "http://localhost:3000/api/v1/price/history?days=7&currency=USD"

# Should return ~168 data points (hourly for 7 days)
```

### Verify Caching

```bash
# First call (slow - fetches from API)
time curl "http://localhost:3000/api/v1/price/historical?date=2024-01-01"

# Second call (fast - from cache)
time curl "http://localhost:3000/api/v1/price/historical?date=2024-01-01"
```

## Data Limitations

### Historical Coverage
- **Bitcoin launched:** January 2009
- **CoinGecko data:** Available from ~2013
- **Early prices:** May be less accurate
- **Recent data:** Most reliable

### Data Points
- **1 day:** Hourly data (~24 points)
- **7 days:** Hourly data (~168 points)
- **30 days:** Daily data (~30 points)
- **90 days:** Daily data (~90 points)
- **365 days:** Daily data (~365 points)

### Accuracy
- Prices are market averages
- May differ slightly from specific exchanges
- Sufficient for portfolio tracking
- Not suitable for trading/arbitrage

## Future Enhancements

1. **Multiple Providers**: Add backup historical price sources
2. **Price Alerts**: Notify when price crosses historical levels
3. **Advanced Charts**: OHLC candlestick data
4. **Comparison**: Compare against traditional assets
5. **Predictions**: ML-based price predictions
6. **Market Events**: Annotate charts with major events
7. **Export**: Download historical data as CSV
8. **Custom Ranges**: Arbitrary date ranges
9. **Intraday Data**: Minute-level historical data
10. **Volume Data**: Historical trading volume

## API Documentation Summary

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/price/historical` | GET | Get price for specific date |
| `/price/history` | GET | Get price history range |
| `/price` | GET | Get current price |
| `/price/multiple` | GET | Get multiple currencies |
| `/price/from/:provider` | GET | Get from specific provider |

### Example Integration

```typescript
// Import API client
import { getPriceService } from './services/price';

const priceService = getPriceService();

// Get historical price
const historicalPrice = await priceService.getHistoricalPrice('USD', new Date('2024-01-01'));
console.log(`BTC was $${historicalPrice.toLocaleString()} on Jan 1, 2024`);

// Get 30-day history
const history = await priceService.getPriceHistory('USD', 30);
console.log(`Fetched ${history.length} price points`);

// Calculate change
const oldestPrice = history[0].price;
const newestPrice = history[history.length - 1].price;
const change = ((newestPrice - oldestPrice) / oldestPrice) * 100;
console.log(`30-day change: ${change.toFixed(2)}%`);
```

## Conclusion

Historical price data is now **fully functional** and **production-ready**:

- ✅ Fetch price for any date since 2013
- ✅ Query price history for up to 1 year
- ✅ Intelligent caching for performance
- ✅ Multiple currency support
- ✅ Comprehensive error handling
- ✅ Ready for portfolio tracking features
- ✅ Optimized for chart rendering
- ✅ Rate limit friendly

Perfect for building portfolio performance graphs, transaction value tracking, and historical analysis!
