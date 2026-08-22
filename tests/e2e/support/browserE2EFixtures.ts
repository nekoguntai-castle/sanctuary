export const BROWSER_E2E_FIXTURES = {
  user: {
    username: 'testuser',
    password: 'testpassword',
  },
  twoFactorUser: {
    username: 'user_with_2fa',
    password: 'password',
  },
  wallet: {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Browser E2E Wallet',
  },
} as const;
