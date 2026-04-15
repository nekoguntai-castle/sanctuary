import * as core from './core';
import * as exportPage from './exportPage';
import * as sync from './sync';

export * from './core';
export * from './exportPage';
export * from './sync';

export const transactionRepository = {
  ...core,
  ...exportPage,
  ...sync,
};

export default transactionRepository;
