export type TransferCompletionResult =
  | { status: 'committed' }
  | { status: 'superseded' }
  | { status: 'failed'; error: unknown };

export type TransferCompletionCallback = () => Promise<TransferCompletionResult>;
