export const ADMIN_USER = {
  id: 'user-ops-admin',
  username: 'admin',
  isAdmin: true,
  usingDefaultPassword: false,
  preferences: {
    darkMode: false,
    theme: 'sanctuary',
    background: 'minimal',
    contrastLevel: 0,
    patternOpacity: 50,
    fiatCurrency: 'USD',
    unit: 'sats',
    showFiat: false,
    priceProvider: 'auto',
  },
  createdAt: '2026-03-11T00:00:00.000Z',
};

export const REGULAR_USER = {
  id: 'user-ops-regular',
  username: 'viewer',
  email: 'viewer@test.com',
  isAdmin: false,
  createdAt: '2026-03-11T00:00:00.000Z',
  updatedAt: '2026-03-11T00:00:00.000Z',
};

export const AGENT_SIGNER_DEVICE = {
  id: 'device-agent-signer',
  label: 'Agent Signer',
  fingerprint: 'aabbccdd',
  type: 'ledger',
  userId: REGULAR_USER.id,
  walletIds: ['wallet-agent-funding'],
};

export const AGENT_FUNDING_WALLET = {
  id: 'wallet-agent-funding',
  name: 'Agent Funding Vault',
  type: 'multi_sig',
  network: 'testnet',
  accessUserIds: [REGULAR_USER.id],
  deviceIds: [AGENT_SIGNER_DEVICE.id],
};

export const AGENT_OPERATIONAL_WALLET = {
  id: 'wallet-agent-operational',
  name: 'Agent Operating Wallet',
  type: 'single_sig',
  network: 'testnet',
  accessUserIds: [REGULAR_USER.id],
  deviceIds: [],
};

const AGENT_ID = 'agent-ops-treasury';

export const WALLET_AGENTS = [
  {
    id: AGENT_ID,
    userId: REGULAR_USER.id,
    name: 'Treasury Agent',
    status: 'active',
    fundingWalletId: AGENT_FUNDING_WALLET.id,
    operationalWalletId: AGENT_OPERATIONAL_WALLET.id,
    signerDeviceId: AGENT_SIGNER_DEVICE.id,
    maxFundingAmountSats: '100000',
    maxOperationalBalanceSats: '250000',
    dailyFundingLimitSats: '500000',
    weeklyFundingLimitSats: '2000000',
    cooldownMinutes: 10,
    minOperationalBalanceSats: '25000',
    largeOperationalSpendSats: '75000',
    largeOperationalFeeSats: '5000',
    repeatedFailureThreshold: 3,
    repeatedFailureLookbackMinutes: 60,
    alertDedupeMinutes: 120,
    requireHumanApproval: true,
    notifyOnOperationalSpend: true,
    pauseOnUnexpectedSpend: true,
    lastFundingDraftAt: '2026-03-11T00:10:00.000Z',
    createdAt: '2026-03-11T00:00:00.000Z',
    updatedAt: '2026-03-11T00:20:00.000Z',
    revokedAt: null,
    user: {
      id: REGULAR_USER.id,
      username: REGULAR_USER.username,
      isAdmin: REGULAR_USER.isAdmin,
    },
    fundingWallet: {
      id: AGENT_FUNDING_WALLET.id,
      name: AGENT_FUNDING_WALLET.name,
      type: AGENT_FUNDING_WALLET.type,
      network: AGENT_FUNDING_WALLET.network,
    },
    operationalWallet: {
      id: AGENT_OPERATIONAL_WALLET.id,
      name: AGENT_OPERATIONAL_WALLET.name,
      type: AGENT_OPERATIONAL_WALLET.type,
      network: AGENT_OPERATIONAL_WALLET.network,
    },
    signerDevice: {
      id: AGENT_SIGNER_DEVICE.id,
      label: AGENT_SIGNER_DEVICE.label,
      fingerprint: AGENT_SIGNER_DEVICE.fingerprint,
    },
    apiKeys: [
      {
        id: 'agent-key-runtime',
        agentId: AGENT_ID,
        createdByUserId: ADMIN_USER.id,
        name: 'Runtime Key',
        keyPrefix: 'agt_ops',
        scope: { allowedActions: ['create_funding_draft'] },
        lastUsedAt: '2026-03-11T00:30:00.000Z',
        lastUsedIp: '127.0.0.1',
        lastUsedAgent: 'sanctuary-agent-runtime',
        expiresAt: null,
        createdAt: '2026-03-11T00:05:00.000Z',
        revokedAt: null,
      },
    ],
  },
];

const AGENT_FUNDING_DRAFT = {
  id: 'draft-agent-funding-1',
  walletId: AGENT_FUNDING_WALLET.id,
  recipient: 'tb1qops',
  amountSats: '50000',
  feeSats: '250',
  feeRate: 2.5,
  status: 'partial',
  approvalStatus: 'not_required',
  createdAt: '2026-03-11T00:10:00.000Z',
  updatedAt: '2026-03-11T00:12:00.000Z',
};

const AGENT_OPERATIONAL_SPEND = {
  id: 'tx-agent-spend-1',
  txid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  walletId: AGENT_OPERATIONAL_WALLET.id,
  type: 'sent',
  amountSats: '12000',
  feeSats: '350',
  confirmations: 0,
  blockTime: null,
  counterpartyAddress: 'tb1qrecipient',
  createdAt: '2026-03-11T00:25:00.000Z',
};

export const AGENT_WALLET_DASHBOARD_ROWS = [
  {
    agent: WALLET_AGENTS[0],
    operationalBalanceSats: '82000',
    pendingFundingDraftCount: 1,
    openAlertCount: 1,
    activeKeyCount: 1,
    lastFundingDraft: AGENT_FUNDING_DRAFT,
    lastOperationalSpend: AGENT_OPERATIONAL_SPEND,
    recentFundingDrafts: [AGENT_FUNDING_DRAFT],
    recentOperationalSpends: [AGENT_OPERATIONAL_SPEND],
    recentAlerts: [
      {
        id: 'alert-agent-balance-low',
        agentId: AGENT_ID,
        walletId: AGENT_OPERATIONAL_WALLET.id,
        type: 'operational_balance_low',
        severity: 'warning',
        status: 'open',
        txid: null,
        amountSats: '82000',
        feeSats: null,
        thresholdSats: '100000',
        observedCount: null,
        reasonCode: null,
        message: 'Operational balance is below threshold',
        dedupeKey: `${AGENT_ID}:balance_low:${AGENT_OPERATIONAL_WALLET.id}`,
        metadata: {},
        createdAt: '2026-03-11T00:20:00.000Z',
        acknowledgedAt: null,
        resolvedAt: null,
      },
    ],
  },
];

export const AGENT_MANAGEMENT_OPTIONS = {
  users: [
    {
      id: REGULAR_USER.id,
      username: REGULAR_USER.username,
      email: REGULAR_USER.email,
      emailVerified: true,
      isAdmin: REGULAR_USER.isAdmin,
      createdAt: REGULAR_USER.createdAt,
      updatedAt: REGULAR_USER.updatedAt,
    },
  ],
  wallets: [AGENT_FUNDING_WALLET, AGENT_OPERATIONAL_WALLET],
  devices: [AGENT_SIGNER_DEVICE],
};

export const FEATURE_FLAGS = [
  {
    key: 'enhancedDashboard',
    enabled: true,
    description: 'Enable enhanced dashboard widgets',
    category: 'general',
    source: 'database',
    modifiedBy: 'admin',
    updatedAt: '2026-03-11T00:00:00.000Z',
  },
  {
    key: 'treasuryAutopilot',
    enabled: false,
    description: 'Enable treasury automation',
    category: 'experimental',
    source: 'environment',
    modifiedBy: null,
    updatedAt: null,
  },
];

export const SYSTEM_SETTINGS = {
  registrationEnabled: false,
  confirmationThreshold: 1,
  deepConfirmationThreshold: 6,
  dustThreshold: 546,
  aiEnabled: false,
};

export const NODE_CONFIG = {
  type: 'electrum',
  explorerUrl: 'https://mempool.space',
  feeEstimatorUrl: 'https://mempool.space',
  mempoolEstimator: 'mempool_space',
  mainnetMode: 'pool',
  mainnetSingletonHost: 'electrum.blockstream.info',
  mainnetSingletonPort: 50002,
  mainnetSingletonSsl: true,
  mainnetPoolMin: 1,
  mainnetPoolMax: 5,
  mainnetPoolLoadBalancing: 'round_robin',
  testnetEnabled: true,
  testnetMode: 'singleton',
  testnetSingletonHost: 'electrum.blockstream.info',
  testnetSingletonPort: 60002,
  testnetSingletonSsl: true,
  testnetPoolMin: 1,
  testnetPoolMax: 3,
  testnetPoolLoadBalancing: 'round_robin',
  signetEnabled: false,
  signetMode: 'singleton',
  signetSingletonHost: 'electrum.mutinynet.com',
  signetSingletonPort: 50002,
  signetSingletonSsl: true,
  signetPoolMin: 1,
  signetPoolMax: 3,
  signetPoolLoadBalancing: 'round_robin',
  proxyEnabled: true,
  proxyHost: 'tor',
  proxyPort: 9050,
};
