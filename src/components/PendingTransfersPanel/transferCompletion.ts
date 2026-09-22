export type TransferCompletionResult =
  | { status: 'committed' }
  | { status: 'access-removed' }
  | { status: 'superseded' }
  | { status: 'failed'; error: unknown };

export type TransferCompletionCallback = () => Promise<TransferCompletionResult>;
