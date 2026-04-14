import { beforeEach, describe } from 'vitest';
import { registerDraftCreationContracts } from './drafts/drafts.creation.contracts';
import { registerDraftMultisigContracts } from './drafts/drafts.multisig.contracts';
import { registerDraftOutputContracts } from './drafts/drafts.outputs.contracts';
import { registerDraftReadContracts } from './drafts/drafts.read.contracts';
import { registerDraftUpdateDeleteContracts } from './drafts/drafts.update-delete.contracts';
import { setupDraftApiMocks } from './drafts/draftsTestHarness';

describe('Draft Transaction API', () => {
  beforeEach(setupDraftApiMocks);

  registerDraftCreationContracts();
  registerDraftReadContracts();
  registerDraftUpdateDeleteContracts();
  registerDraftOutputContracts();
  registerDraftMultisigContracts();
});
