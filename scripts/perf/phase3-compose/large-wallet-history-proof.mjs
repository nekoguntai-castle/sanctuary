
import {
  getErrorMessage,
  sqlLiteral,
  summarizeDurations,
} from './common.mjs';

export function createLargeWalletTransactionHistoryProofRunner(context) {
  const {
    timestamp,
    apiUrl,
    largeWalletTransactionCount,
    largeWalletHistoryRequests,
    largeWalletHistoryConcurrency,
    largeWalletHistoryPageSize,
    largeWalletHistoryP95BudgetMs,
    runPostgresJson,
    loginForProof,
    publicApiJson,
    timedPublicApiJson,
  } = context;

  async function runLargeWalletTransactionHistoryProof() {
    const token = await loginForProof();
    const wallet = await createLargeWalletProofWallet(token);
    const seed = seedLargeWalletTransactions(wallet.id);
    const url = `${apiUrl}/api/v1/wallets/${encodeURIComponent(wallet.id)}/transactions?limit=${largeWalletHistoryPageSize}&offset=0`;
    const records = [];
  
    await runPool(largeWalletHistoryRequests, largeWalletHistoryConcurrency, async () => {
      const startedAt = Date.now();
      try {
        const response = await timedPublicApiJson(url, { token });
        const parsed = response.body;
        const expectedPageSize = Math.min(largeWalletHistoryPageSize, seed.transactionCount);
        const bodyOk = Array.isArray(parsed) && parsed.length === expectedPageSize;
  
        records.push({
          ok: response.status === 200 && bodyOk,
          status: response.status,
          durationMs: response.durationMs,
          rowCount: Array.isArray(parsed) ? parsed.length : null,
          error: response.status === 200 && bodyOk
            ? null
            : `expected ${expectedPageSize} transactions, received ${Array.isArray(parsed) ? parsed.length : typeof parsed}`,
        });
      } catch (error) {
        records.push({
          ok: false,
          status: 'error',
          durationMs: Date.now() - startedAt,
          rowCount: null,
          error: getErrorMessage(error),
        });
      }
    });
  
    const latency = summarizeDurations(records.map((record) => record.durationMs));
    const failures = records.filter((record) => !record.ok);
    const statusCounts = records.reduce((counts, record) => {
      const key = String(record.status || 'error');
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    const p95Ms = latency.p95Ms ?? Number.POSITIVE_INFINITY;
    const passed = failures.length === 0 && p95Ms <= largeWalletHistoryP95BudgetMs;
    const proof = {
      proofId: timestamp,
      status: passed ? 'passed' : 'failed',
      wallet,
      dataset: {
        kind: 'synthetic-local-large-wallet',
        requestedTransactions: largeWalletTransactionCount,
        insertedTransactions: seed.insertedTransactions,
        transactionCount: seed.transactionCount,
        pageSize: largeWalletHistoryPageSize,
      },
      traffic: {
        requests: largeWalletHistoryRequests,
        concurrency: largeWalletHistoryConcurrency,
        endpoint: '/api/v1/wallets/:walletId/transactions',
      },
      gate: {
        p95BudgetMs: largeWalletHistoryP95BudgetMs,
      },
      statusCounts,
      latency,
      failures: failures
        .map((record) => record.error || `status ${record.status}`)
        .slice(0, 5),
    };
  
    if (!passed) {
      throw new Error(`Large-wallet transaction-history proof failed: ${JSON.stringify(proof)}`);
    }
  
    return proof;
  }
  
  async function createLargeWalletProofWallet(token) {
    const walletName = `Phase 3 Large Wallet ${timestamp}`;
    const response = await publicApiJson(`${apiUrl}/api/v1/wallets`, {
      method: 'POST',
      token,
      body: {
        name: walletName,
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      },
    }, [201]);
  
    if (!response || typeof response !== 'object' || typeof response.id !== 'string') {
      throw new Error('wallet creation response did not include an id');
    }
  
    return {
      id: response.id,
      name: response.name || walletName,
      network: response.network || 'testnet',
    };
  }
  
  function seedLargeWalletTransactions(walletId) {
    const sql = `
  WITH generated AS (
  SELECT
    gs,
    md5(${sqlLiteral(timestamp)} || ':' || ${sqlLiteral(walletId)} || ':' || gs::text) AS h1,
    md5(${sqlLiteral(timestamp)} || ':' || ${sqlLiteral(walletId)} || ':tail:' || gs::text) AS h2
  FROM generate_series(1, ${largeWalletTransactionCount}) AS gs
  ),
  inserted AS (
  INSERT INTO "transactions" (
    "id",
    "txid",
    "walletId",
    "type",
    "amount",
    "fee",
    "balanceAfter",
    "confirmations",
    "blockHeight",
    "blockTime",
    "label",
    "memo",
    "rawTx",
    "counterpartyAddress",
    "createdAt",
    "updatedAt",
    "rbfStatus"
  )
  SELECT
    'phase3-' || h1,
    h1 || h2,
    ${sqlLiteral(walletId)},
    CASE WHEN gs % 5 = 0 THEN 'sent' ELSE 'received' END,
    CASE WHEN gs % 5 = 0 THEN -((100000 + gs)::bigint) ELSE (100000 + gs)::bigint END,
    CASE WHEN gs % 5 = 0 THEN 12::bigint ELSE NULL END,
    (100000000 + gs)::bigint,
    6 + (gs % 100),
    2500000 - gs,
    now() - (gs::text || ' minutes')::interval,
    'phase3 synthetic large-wallet fixture',
    'synthetic benchmark transaction ' || gs::text,
    NULL,
    'tb1qphase3benchmark' || gs::text,
    now() - (gs::text || ' minutes')::interval,
    now(),
    'active'
  FROM generated
  ON CONFLICT ("txid", "walletId") DO NOTHING
  RETURNING 1
  )
  SELECT json_build_object(
  'walletId', ${sqlLiteral(walletId)},
  'requestedTransactions', ${largeWalletTransactionCount},
  'insertedTransactions', (SELECT COUNT(*) FROM inserted),
  'transactionCount', (SELECT COUNT(*) FROM inserted)
  );
  `;
  
    return runPostgresJson(sql);
  }
  
  async function runPool(total, limit, worker) {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, total) }, async () => {
      while (next < total) {
        const index = next;
        next += 1;
        await worker(index);
      }
    });
    await Promise.all(workers);
  }
  
  function summarizeLargeWalletTransactionHistoryProof(proof) {
    return `${proof.dataset.transactionCount} synthetic transactions; ${proof.traffic.requests} requests at concurrency ${proof.traffic.concurrency}; p95=${proof.latency.p95Ms}ms target<=${proof.gate.p95BudgetMs}ms`;
  }

  return {
    runLargeWalletTransactionHistoryProof,
    summarizeLargeWalletTransactionHistoryProof,
  };
}
